"""
routers/deliveries.py — Delivery Kanban board, status transitions, and rider assignments using PostgreSQL.
GET    /api/deliveries
POST   /api/deliveries
PATCH  /api/deliveries/{id}/status
PATCH  /api/deliveries/{id}/assign
GET    /api/deliveries/riders
GET    /api/deliveries/stream  (Server-Sent Events)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import asyncio
import json

from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/deliveries", tags=["deliveries"])

_subscribers: List[asyncio.Queue] = []


async def broadcast_delivery_event(event_type: str, data: dict):
    payload = json.dumps({"event": event_type, "data": data})
    for queue in list(_subscribers):
        try:
            await queue.put(payload)
        except Exception:
            pass


class CreateDeliveryIn(BaseModel):
    branch_id: Optional[str] = None
    customer_id: str
    sale_id: Optional[str] = None
    rider_id: Optional[str] = None
    address: Optional[str] = None
    barangay: Optional[str] = None
    gallons: Optional[int] = 5
    slim_count: Optional[int] = 5
    round_count: Optional[int] = 0
    amount: Optional[float] = None
    payment_method: Optional[str] = "cash"
    is_paid: Optional[bool] = False
    notes: Optional[str] = None


class StatusUpdateIn(BaseModel):
    status: str
    notes: Optional[str] = None


class AssignRiderIn(BaseModel):
    rider_id: Optional[str] = None


@router.get("")
async def list_deliveries(
    branch_id: Optional[str] = Query(None),
    rider_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    conditions = []
    params = []
    idx = 1

    if bid and current_user["role"] != "owner":
        conditions.append(f"d.branch_id = ${idx}")
        params.append(str(bid))
        idx += 1
    elif branch_id:
        conditions.append(f"d.branch_id = ${idx}")
        params.append(str(branch_id))
        idx += 1

    if rider_id:
        conditions.append(f"d.rider_id = ${idx}")
        params.append(str(rider_id))
        idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    query = f"""
        SELECT d.*,
               c.full_name AS customer_name, c.phone AS customer_phone,
               c.address AS customer_address, c.barangay AS customer_barangay,
               u.full_name AS rider_name
        FROM delivery_orders d
        LEFT JOIN customers c ON d.customer_id = c.id
        LEFT JOIN users u ON d.rider_id = u.id
        {where}
        ORDER BY d.created_at DESC
        LIMIT 100
    """
    orders = await db.fetch_all(query, *params)
    for o in orders:
        o["customers"] = {
            "full_name": o.get("customer_name") or "",
            "phone": o.get("customer_phone") or "",
            "address": o.get("customer_address") or o.get("delivery_address") or "",
            "barangay": o.get("customer_barangay") or o.get("barangay") or ""
        }
        o["rider"] = {
            "full_name": o.get("rider_name") or "Unassigned"
        }

    return orders


@router.post("", status_code=201)
async def create_delivery(
    body: CreateDeliveryIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = await db.resolve_branch(body.branch_id, current_user)
    cust = await db.fetch_one("SELECT * FROM customers WHERE id = $1", body.customer_id)
    cust_addr = body.address or (cust.get("address", "") if cust else "")
    cust_brgy = body.barangay or (cust.get("barangay", "") if cust else "")
    cust_type = cust.get("type", "regular") if cust else "regular"

    gallons = body.gallons or body.slim_count or 5
    amount = body.amount
    if amount is None or amount <= 0:
        tier_prices = {"regular": 28.0, "reseller": 22.0, "commercial": 25.0, "walk_in": 30.0}
        unit_price = tier_prices.get(cust_type, 28.0)
        amount = gallons * unit_price

    pay_method = (body.payment_method or "cash").lower()
    is_paid = True if pay_method == "gcash" else bool(body.is_paid)
    delivery_status = "assigned" if body.rider_id else "pending"

    query = """
        INSERT INTO delivery_orders (
            branch_id, customer_id, sale_id, rider_id, status, delivery_address,
            barangay, gallons, slim_count, round_count, amount, payment_method,
            is_paid, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
    """
    created = await db.fetch_one(
        query,
        str(bid) if bid else None, body.customer_id, body.sale_id, body.rider_id,
        delivery_status, cust_addr, cust_brgy, gallons, body.slim_count or gallons,
        body.round_count or 0, float(amount), pay_method, is_paid, body.notes
    )

    rider = await db.fetch_one("SELECT full_name FROM users WHERE id = $1", body.rider_id) if body.rider_id else None
    created["customer_name"] = cust.get("full_name") if cust else "Customer"
    created["rider_name"] = rider.get("full_name") if rider else "Unassigned"
    created["customers"] = {
        "full_name": cust.get("full_name") if cust else "Customer",
        "phone": cust.get("phone", "") if cust else "",
        "address": cust_addr,
        "barangay": cust_brgy
    }
    created["rider"] = {
        "full_name": rider.get("full_name") if rider else "Unassigned"
    }

    await broadcast_delivery_event("created", created)
    return created


@router.patch("/{delivery_id}/status")
async def update_delivery_status(
    delivery_id: str,
    body: StatusUpdateIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    valid_statuses = {"pending", "assigned", "out_for_delivery", "delivered", "cancelled"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    deliv = await db.fetch_one("SELECT * FROM delivery_orders WHERE id = $1", delivery_id)
    if not deliv:
        raise HTTPException(status_code=404, detail="Delivery order not found")

    dispatched = "NOW()" if body.status == "out_for_delivery" else "dispatched_at"
    delivered = "NOW()" if body.status == "delivered" else "delivered_at"
    is_paid_sql = "TRUE" if (body.status == "delivered" and deliv.get("payment_method") in ("cash", "cod")) else "is_paid"

    query = f"""
        UPDATE delivery_orders
        SET status = $2,
            notes = COALESCE($3, notes),
            is_paid = {is_paid_sql},
            dispatched_at = {dispatched},
            delivered_at = {delivered}
        WHERE id = $1
        RETURNING *
    """
    updated = await db.fetch_one(query, delivery_id, body.status, body.notes)

    cust = await db.fetch_one("SELECT full_name, phone, address, barangay FROM customers WHERE id = $1", updated["customer_id"]) if updated.get("customer_id") else None
    rider = await db.fetch_one("SELECT full_name FROM users WHERE id = $1", updated["rider_id"]) if updated.get("rider_id") else None
    updated["customer_name"] = cust.get("full_name") if cust else ""
    updated["rider_name"] = rider.get("full_name") if rider else "Unassigned"
    updated["customers"] = cust or {}
    updated["rider"] = {"full_name": updated["rider_name"]}

    await broadcast_delivery_event("status_changed", updated)
    return updated


@router.patch("/{delivery_id}/assign")
async def assign_rider(
    delivery_id: str,
    body: AssignRiderIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if not body.rider_id:
        query = """
            UPDATE delivery_orders
            SET rider_id = NULL,
                status = CASE WHEN status = 'assigned' THEN 'pending' ELSE status END
            WHERE id = $1
            RETURNING *
        """
        updated = await db.fetch_one(query, delivery_id)
    else:
        rider = await db.fetch_one("SELECT * FROM users WHERE id = $1 AND role = 'rider'", body.rider_id)
        if not rider:
            raise HTTPException(status_code=404, detail="Rider not found")

        query = """
            UPDATE delivery_orders
            SET rider_id = $2,
                status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END
            WHERE id = $1
            RETURNING *
        """
        updated = await db.fetch_one(query, delivery_id, body.rider_id)

    if not updated:
        raise HTTPException(status_code=404, detail="Delivery order not found")

    cust = await db.fetch_one("SELECT full_name, phone, address, barangay FROM customers WHERE id = $1", updated["customer_id"]) if updated.get("customer_id") else None
    rider = await db.fetch_one("SELECT full_name FROM users WHERE id = $1", updated["rider_id"]) if updated.get("rider_id") else None
    updated["customer_name"] = cust.get("full_name") if cust else ""
    updated["rider_name"] = rider.get("full_name") if rider else "Unassigned"
    updated["customers"] = cust or {}
    updated["rider"] = {"full_name": updated["rider_name"]}

    await broadcast_delivery_event("assigned", updated)
    return updated


@router.get("/riders")
async def list_riders(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    riders = []
    if bid and current_user["role"] != "owner":
        query = "SELECT id, full_name, phone FROM users WHERE role = 'rider' AND is_active = TRUE AND (branch_id = $1 OR branch_id IS NULL) ORDER BY full_name ASC"
        riders = await db.fetch_all(query, str(bid))
    elif branch_id:
        query = "SELECT id, full_name, phone FROM users WHERE role = 'rider' AND is_active = TRUE AND (branch_id = $1 OR branch_id IS NULL) ORDER BY full_name ASC"
        riders = await db.fetch_all(query, str(branch_id))

    if not riders:
        query = "SELECT id, full_name, phone FROM users WHERE role = 'rider' AND is_active = TRUE ORDER BY full_name ASC"
        riders = await db.fetch_all(query)

    return riders


@router.get("/stream")
async def delivery_sse_stream():
    queue = asyncio.Queue()
    _subscribers.append(queue)

    async def event_generator():
        try:
            yield "data: {\"event\": \"connected\"}\n\n"
            while True:
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
