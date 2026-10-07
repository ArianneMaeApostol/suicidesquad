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
    branch_id: str
    customer_id: str
    sale_id: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class StatusUpdateIn(BaseModel):
    status: str
    notes: Optional[str] = None


class AssignRiderIn(BaseModel):
    rider_id: str


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
    cust = await db.fetch_one("SELECT * FROM customers WHERE id = $1", body.customer_id)
    cust_addr = body.address or (cust.get("address", "") if cust else "")
    cust_brgy = cust.get("barangay", "") if cust else ""

    query = """
        INSERT INTO delivery_orders (
            branch_id, customer_id, sale_id, status, delivery_address,
            barangay, notes
        )
        VALUES ($1, $2, $3, 'pending', $4, $5, $6)
        RETURNING *
    """
    created = await db.fetch_one(
        query,
        body.branch_id, body.customer_id, body.sale_id, cust_addr, cust_brgy, body.notes
    )
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

    query = f"""
        UPDATE delivery_orders
        SET status = $2,
            notes = COALESCE($3, notes),
            dispatched_at = {dispatched},
            delivered_at = {delivered}
        WHERE id = $1
        RETURNING *
    """
    updated = await db.fetch_one(query, delivery_id, body.status, body.notes)
    await broadcast_delivery_event("status_changed", updated)
    return updated


@router.patch("/{delivery_id}/assign")
async def assign_rider(
    delivery_id: str,
    body: AssignRiderIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
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

    await broadcast_delivery_event("assigned", updated)
    return updated


@router.get("/riders")
async def list_riders(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    if bid and current_user["role"] != "owner":
        query = "SELECT id, full_name, phone FROM users WHERE role = 'rider' AND is_active = TRUE AND branch_id = $1"
        return await db.fetch_all(query, str(bid))
    elif branch_id:
        query = "SELECT id, full_name, phone FROM users WHERE role = 'rider' AND is_active = TRUE AND branch_id = $1"
        return await db.fetch_all(query, str(branch_id))
    else:
        query = "SELECT id, full_name, phone FROM users WHERE role = 'rider' AND is_active = TRUE"
        return await db.fetch_all(query)


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
