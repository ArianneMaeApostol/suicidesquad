"""
routers/sales.py — Sales transactions, voiding, and recent sales queries using PostgreSQL.
POST /api/sales
GET  /api/sales
POST /api/sales/{sale_id}/void
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, timezone
import random

from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/sales", tags=["sales"])


class SaleItemIn(BaseModel):
    product_id: str
    qty: int
    unit_price: Optional[float] = None
    subtotal: Optional[float] = None
    gallons_lent: Optional[int] = 0
    gallons_returned: Optional[int] = 0


class CreateSaleIn(BaseModel):
    branch_id: str
    customer_id: Optional[str] = None
    sale_type: str = "walk_in"
    items: List[SaleItemIn]
    payment_method: str = "cash"
    amount_paid: float = 0.0
    discount: float = 0.0
    containers_lent: int = 0
    containers_back: int = 0


class VoidSaleIn(BaseModel):
    reason: Optional[str] = "Customer request / error"


@router.post("", status_code=201)
async def create_sale(
    body: CreateSaleIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = await db.resolve_branch(body.branch_id, current_user)

    # 1. Find active shift if any
    active_shift = await db.fetch_one(
        "SELECT id FROM shifts WHERE branch_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
        bid
    )
    shift_id = active_shift["id"] if active_shift else None

    # 2. Customer tier check
    customer = None
    customer_tier = "walk_in"
    if body.customer_id:
        customer = await db.fetch_one("SELECT * FROM customers WHERE id = $1", body.customer_id)
        if customer:
            customer_tier = customer.get("type", "walk_in")

    # 3. Resolve items and calculate subtotal
    line_items = []
    calc_subtotal = 0.0

    for item in body.items:
        prod = await db.fetch_one("SELECT * FROM products WHERE id = $1", item.product_id)
        prod_name = prod["name"] if prod else "Refill Item"

        unit_price = item.unit_price
        if unit_price is None or unit_price == 0:
            price_row = await db.fetch_one(
                "SELECT price FROM product_prices WHERE product_id = $1 AND customer_type = $2",
                item.product_id, customer_tier
            )
            unit_price = float(price_row["price"]) if price_row else 30.0

        item_subtotal = item.subtotal if item.subtotal is not None else (unit_price * item.qty)
        calc_subtotal += item_subtotal

        line_items.append({
            "product_id": item.product_id,
            "product_name": prod_name,
            "qty": item.qty,
            "unit_price": float(unit_price),
            "subtotal": float(item_subtotal),
            "gallons_lent": item.gallons_lent or 0,
            "gallons_returned": item.gallons_returned or 0,
        })

    total_amount = max(calc_subtotal - (body.discount or 0.0), 0.0)
    amount_paid = float(body.amount_paid) if body.payment_method != "credit" else 0.0
    change_amount = max(amount_paid - total_amount, 0.0) if body.payment_method == "cash" else 0.0

    # Generate sale number
    sale_number = f"INV-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"

    # 4. Insert Sale
    sale_query = """
        INSERT INTO sales (
            sale_number, branch_id, shift_id, customer_id, cashier_id,
            sale_type, payment_method, subtotal, discount, total,
            amount_paid, change_amount, containers_lent, containers_back,
            status, is_voided
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'completed', FALSE)
        RETURNING id
    """
    sale_id = await db.fetch_val(
        sale_query,
        sale_number, bid, shift_id, body.customer_id, str(current_user["id"]),
        body.sale_type, body.payment_method, calc_subtotal, body.discount,
        total_amount, amount_paid, change_amount, body.containers_lent, body.containers_back
    )

    # 5. Insert Sale Items
    for li in line_items:
        await db.execute(
            """
            INSERT INTO sale_items (
                sale_id, product_id, product_name, qty, unit_price, subtotal,
                gallons_lent, gallons_returned
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            sale_id, li["product_id"], li["product_name"], li["qty"],
            li["unit_price"], li["subtotal"], li["gallons_lent"], li["gallons_returned"]
        )

    # 6. Customer Account and Container Ledger Updates
    if body.customer_id:
        # If paid with credit (utang), increase customer debt balance
        if body.payment_method == "credit":
            await db.execute(
                "UPDATE customers SET balance = balance + $2, updated_at = NOW() WHERE id = $1",
                body.customer_id, total_amount
            )

        # Update container balance if lent or returned
        net_containers = (body.containers_lent or 0) - (body.containers_back or 0)
        if net_containers != 0:
            await db.execute(
                "UPDATE customers SET containers_out = GREATEST(containers_out + $2, 0), updated_at = NOW() WHERE id = $1",
                body.customer_id, net_containers
            )
            curr_cust = await db.fetch_one("SELECT containers_out FROM customers WHERE id = $1", body.customer_id)
            new_bal = curr_cust["containers_out"] if curr_cust else 0
            await db.execute(
                """
                INSERT INTO container_ledger (customer_id, sale_id, container_type, quantity_change, balance_after, notes)
                VALUES ($1, $2, 'slim', $3, $4, $5)
                """,
                body.customer_id, sale_id, net_containers, new_bal, f"Sale transaction {sale_number}"
            )

    # 7. Auto-create Delivery Order if sale_type is delivery
    if body.sale_type == "delivery" and body.customer_id:
        total_gallons = sum(li["qty"] for li in line_items)
        cust_addr = customer.get("address", "") if customer else ""
        cust_brgy = customer.get("barangay", "") if customer else ""
        await db.execute(
            """
            INSERT INTO delivery_orders (
                branch_id, customer_id, sale_id, status, delivery_address,
                barangay, gallons, amount, payment_method, is_paid
            )
            VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9)
            """,
            bid, body.customer_id, sale_id, cust_addr, cust_brgy,
            total_gallons, total_amount, body.payment_method, (body.payment_method != "credit")
        )

    return str(sale_id)


@router.get("")
async def list_sales(
    branch_id: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = "WHERE s.is_voided = FALSE"
    if bid and current_user["role"] != "owner":
        where += " AND s.branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where += " AND s.branch_id = $1"
        params.append(str(branch_id))

    params.append(limit)
    limit_idx = len(params)

    query = f"""
        SELECT s.*, c.full_name AS customer_name, u.full_name AS cashier_name
        FROM sales s
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN users u ON s.cashier_id = u.id
        {where}
        ORDER BY s.created_at DESC
        LIMIT ${limit_idx}
    """
    sales = await db.fetch_all(query, *params)
    for s in sales:
        s["customer"] = {"full_name": s.get("customer_name") or "Walk-in Customer"}
    return sales


@router.post("/{sale_id}/void")
async def void_sale(
    sale_id: str,
    body: VoidSaleIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    sale = await db.fetch_one("SELECT * FROM sales WHERE id = $1", sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.get("is_voided"):
        raise HTTPException(status_code=400, detail="Sale is already voided")

    # Mark voided
    await db.execute(
        """
        UPDATE sales
        SET is_voided = TRUE, status = 'voided', void_reason = $2
        WHERE id = $1
        """,
        sale_id, body.reason
    )

    # Revert customer balance if credit sale
    if sale.get("payment_method") == "credit" and sale.get("customer_id"):
        await db.execute(
            "UPDATE customers SET balance = balance - $2, updated_at = NOW() WHERE id = $1",
            sale["customer_id"], float(sale.get("total", 0.0))
        )

    # Revert containers
    net_containers = (sale.get("containers_lent") or 0) - (sale.get("containers_back") or 0)
    if net_containers != 0 and sale.get("customer_id"):
        await db.execute(
            "UPDATE customers SET containers_out = GREATEST(containers_out - $2, 0), updated_at = NOW() WHERE id = $1",
            sale["customer_id"], net_containers
        )

    return {"message": "Sale voided successfully", "sale_id": sale_id}
