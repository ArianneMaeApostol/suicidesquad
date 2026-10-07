"""
routers/payments.py — Account payment recording and customer payment ledger using PostgreSQL.
POST /api/payments
GET  /api/payments
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional

from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/payments", tags=["payments"])


class PaymentIn(BaseModel):
    customer_id: str
    amount: float
    method: str = "cash"
    reference: Optional[str] = None
    notes: Optional[str] = None


@router.post("", status_code=201)
async def record_payment(
    body: PaymentIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    customer = await db.fetch_one("SELECT * FROM customers WHERE id = $1", body.customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    bid = customer.get("branch_id") or current_user.get("branch_id")
    amt = float(body.amount)

    query = """
        INSERT INTO payments (
            customer_id, customer_name, branch_id, cashier_id, cashier_name,
            amount, payment_method, reference_no, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
    """
    payment = await db.fetch_one(
        query,
        body.customer_id, customer["full_name"], bid, str(current_user["id"]),
        current_user.get("full_name"), amt, body.method, body.reference, body.notes
    )

    # Deduct customer debt balance
    await db.execute(
        "UPDATE customers SET balance = balance - $2, updated_at = NOW() WHERE id = $1",
        body.customer_id, amt
    )

    return payment


@router.get("")
async def list_payments(
    customer_id: Optional[str] = Query(None),
    branch_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    conditions = []
    params = []
    idx = 1

    if customer_id:
        conditions.append(f"customer_id = ${idx}")
        params.append(customer_id)
        idx += 1

    if branch_id:
        conditions.append(f"branch_id = ${idx}")
        params.append(branch_id)
        idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)
    limit_idx = len(params)

    query = f"""
        SELECT * FROM payments
        {where}
        ORDER BY created_at DESC
        LIMIT ${limit_idx}
    """
    return await db.fetch_all(query, *params)
