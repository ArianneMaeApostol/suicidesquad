"""
routers/products.py — Product & Price Tier CRUD using PostgreSQL.
GET    /api/products
POST   /api/products
PATCH  /api/products/{id}
POST   /api/products/{id}/prices  (upsert tier price)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/products", tags=["products"])


class ProductPriceItem(BaseModel):
    customer_type: str
    price: float


class ProductIn(BaseModel):
    name: str
    unit: str = "gallon"
    category: Optional[str] = "custom"
    description: Optional[str] = "Custom Station Item"
    price: Optional[float] = None
    is_container: bool = False
    branch_id: Optional[str] = None
    product_prices: Optional[List[ProductPriceItem]] = None


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    is_container: Optional[bool] = None
    is_active: Optional[bool] = None


class PriceUpsertIn(BaseModel):
    customer_type: str
    price: float


@router.get("")
async def list_products(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    if bid and current_user["role"] != "owner":
        query = """
            SELECT * FROM products
            WHERE is_active = TRUE AND (branch_id = $1 OR branch_id IS NULL)
            ORDER BY created_at DESC, name ASC
        """
        products = await db.fetch_all(query, str(bid))
    elif bid:
        query = """
            SELECT * FROM products
            WHERE is_active = TRUE AND (branch_id = $1 OR branch_id IS NULL)
            ORDER BY created_at DESC, name ASC
        """
        products = await db.fetch_all(query, str(bid))
    else:
        query = "SELECT * FROM products WHERE is_active = TRUE ORDER BY created_at DESC, name ASC"
        products = await db.fetch_all(query)

    # Attach product prices
    prices = await db.fetch_all("SELECT product_id, customer_type, price FROM product_prices")
    price_map = {}
    for p in prices:
        pid = p["product_id"]
        if pid not in price_map:
            price_map[pid] = []
        price_map[pid].append({
            "customer_type": p["customer_type"],
            "price": float(p["price"])
        })

    for prod in products:
        prod["product_prices"] = price_map.get(prod["id"], [])
        if prod["product_prices"]:
            prod["price"] = prod["product_prices"][0]["price"]

    return products


@router.post("", status_code=201)
async def create_product(
    body: ProductIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = await db.resolve_branch(body.branch_id, current_user)
    prod_query = """
        INSERT INTO products (name, unit, category, description, is_container, branch_id, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING *
    """
    product = await db.fetch_one(
        prod_query,
        body.name, body.unit, body.category or "custom", body.description or "Custom Station Item", body.is_container, str(bid) if bid else None
    )

    saved_prices = []
    prices_to_insert = body.product_prices or []
    if not prices_to_insert and body.price is not None:
        prices_to_insert = [
            ProductPriceItem(customer_type="walk_in", price=float(body.price)),
            ProductPriceItem(customer_type="regular", price=float(body.price)),
            ProductPriceItem(customer_type="reseller", price=float(body.price)),
            ProductPriceItem(customer_type="commercial", price=float(body.price)),
        ]

    for p in prices_to_insert:
        pp = await db.fetch_one(
            """
            INSERT INTO product_prices (product_id, customer_type, price)
            VALUES ($1, $2, $3)
            RETURNING customer_type, price
            """,
            product["id"], p.customer_type, float(p.price)
        )
        saved_prices.append(pp)

    product["product_prices"] = saved_prices
    product["price"] = saved_prices[0]["price"] if saved_prices else (body.price or 0.0)
    return product



@router.patch("/{product_id}")
async def update_product(
    product_id: str,
    body: ProductUpdate,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        UPDATE products
        SET name = COALESCE($2, name),
            unit = COALESCE($3, unit),
            is_container = COALESCE($4, is_container),
            is_active = COALESCE($5, is_active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    """
    updated = await db.fetch_one(
        query,
        product_id, body.name, body.unit, body.is_container, body.is_active
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Product not found")

    prices = await db.fetch_all(
        "SELECT customer_type, price FROM product_prices WHERE product_id = $1",
        product_id
    )
    updated["product_prices"] = prices
    return updated


@router.post("/{product_id}/prices")
async def upsert_product_price(
    product_id: str,
    body: PriceUpsertIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    prod = await db.fetch_one("SELECT id FROM products WHERE id = $1", product_id)
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")

    query = """
        INSERT INTO product_prices (product_id, customer_type, price)
        VALUES ($1, $2, $3)
        ON CONFLICT (product_id, customer_type)
        DO UPDATE SET price = EXCLUDED.price
        RETURNING customer_type, price
    """
    await db.fetch_one(query, product_id, body.customer_type, float(body.price))

    all_prices = await db.fetch_all(
        "SELECT customer_type, price FROM product_prices WHERE product_id = $1",
        product_id
    )
    return {"message": "Price updated", "product_prices": all_prices}
