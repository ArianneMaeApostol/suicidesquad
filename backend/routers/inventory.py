"""
routers/inventory.py — Stock inventory, suppliers, movements, and low stock alerts using PostgreSQL.
GET  /api/inventory
POST /api/inventory/items
GET  /api/inventory/suppliers
POST /api/inventory/suppliers
POST /api/inventory/movements
GET  /api/inventory/low-stock
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional

from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class InventoryItemIn(BaseModel):
    branch_id: str
    name: str
    unit: str = "pcs"
    quantity: float = 0.0
    reorder_point: float = 10.0
    cost_per_unit: Optional[float] = 0.0
    supplier_id: Optional[str] = None


class SupplierIn(BaseModel):
    branch_id: Optional[str] = None
    name: str
    contact: Optional[str] = None
    address: Optional[str] = None


class StockMovementIn(BaseModel):
    branch_id: str
    item_id: str
    type: str  # "in" | "out" | "adjustment"
    qty: float
    note: Optional[str] = None


@router.get("")
async def list_inventory(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = ""
    if bid and current_user["role"] != "owner":
        where = "WHERE i.branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where = "WHERE i.branch_id = $1"
        params.append(str(branch_id))

    query = f"""
        SELECT i.*, s.name AS supplier_name
        FROM inventory_items i
        LEFT JOIN suppliers s ON i.supplier_id = s.id
        {where}
        ORDER BY i.name ASC
    """
    items = await db.fetch_all(query, *params)
    for it in items:
        it["suppliers"] = {"name": it.get("supplier_name") or "General Supplier"}
    return items


@router.post("/items", status_code=201)
async def create_inventory_item(
    body: InventoryItemIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        INSERT INTO inventory_items (
            branch_id, supplier_id, name, unit, quantity,
            reorder_point, cost_per_unit
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
    """
    created = await db.fetch_one(
        query,
        body.branch_id, body.supplier_id, body.name, body.unit,
        body.quantity, body.reorder_point, body.cost_per_unit or 0.0
    )
    return created


@router.get("/suppliers")
async def list_suppliers(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    return await db.fetch_all("SELECT * FROM suppliers ORDER BY name ASC")


@router.post("/suppliers", status_code=201)
async def create_supplier(
    body: SupplierIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        INSERT INTO suppliers (branch_id, name, contact, address)
        VALUES ($1, $2, $3, $4)
        RETURNING *
    """
    created = await db.fetch_one(query, body.branch_id, body.name, body.contact, body.address)
    return created


@router.post("/movements", status_code=201)
async def record_movement(
    body: StockMovementIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    item = await db.fetch_one("SELECT * FROM inventory_items WHERE id = $1", body.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    m_query = """
        INSERT INTO inventory_movements (branch_id, item_id, type, qty, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    """
    await db.fetch_one(m_query, body.branch_id, body.item_id, body.type, body.qty, body.note)

    # Adjust stock
    delta = body.qty if body.type == "in" else -body.qty
    u_query = """
        UPDATE inventory_items
        SET quantity = GREATEST(quantity + $2, 0), updated_at = NOW()
        WHERE id = $1
        RETURNING *
    """
    updated = await db.fetch_one(u_query, body.item_id, delta)
    return updated


@router.get("/low-stock")
async def get_low_stock(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = "WHERE quantity <= reorder_point"
    if bid and current_user["role"] != "owner":
        where += " AND branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where += " AND branch_id = $1"
        params.append(str(branch_id))

    query = f"""
        SELECT * FROM inventory_items
        {where}
        ORDER BY quantity ASC
        LIMIT 10
    """
    return await db.fetch_all(query, *params)
