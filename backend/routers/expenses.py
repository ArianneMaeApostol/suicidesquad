"""
routers/expenses.py — Operating expenses CRUD using PostgreSQL.
GET  /api/expenses
POST /api/expenses
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


class ExpenseIn(BaseModel):
    branch_id: Optional[str] = None
    category: str  # utilities, supplies, salaries, rent, maintenance, other
    description: str
    amount: float
    payment_method: Optional[str] = "cash"
    payment_mode: Optional[str] = None
    reference_no: Optional[str] = None
    date: Optional[str] = None


@router.get("")
async def list_expenses(
    branch_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    conditions = []
    params = []
    idx = 1

    if bid and current_user["role"] != "owner":
        conditions.append(f"branch_id = ${idx}")
        params.append(str(bid))
        idx += 1
    elif branch_id:
        conditions.append(f"branch_id = ${idx}")
        params.append(str(branch_id))
        idx += 1

    if start_date:
        conditions.append(f"to_char(date, 'YYYY-MM-DD') >= ${idx}")
        params.append(start_date)
        idx += 1

    if end_date:
        conditions.append(f"to_char(date, 'YYYY-MM-DD') <= ${idx}")
        params.append(end_date)
        idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    query = f"""
        SELECT * FROM expenses
        {where}
        ORDER BY date DESC, created_at DESC
        LIMIT 200
    """
    return await db.fetch_all(query, *params)


@router.post("", status_code=201)
async def create_expense(
    body: ExpenseIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Expense amount must be greater than ₱0.00")

    bid = body.branch_id or current_user.get("branch_id")
    pay_method = body.payment_method or body.payment_mode or "cash"

    # Safely parse date into a datetime.date object for asyncpg
    expense_date = datetime.now(timezone.utc).date()
    if body.date:
        try:
            cleaned_date = body.date.split("T")[0]
            expense_date = datetime.strptime(cleaned_date, "%Y-%m-%d").date()
        except Exception:
            expense_date = datetime.now(timezone.utc).date()

    query = """
        INSERT INTO expenses (
            branch_id, category, description, amount, payment_method,
            reference_no, date, recorded_by, recorder_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
    """
    return await db.fetch_one(
        query,
        str(bid) if bid else None, body.category, body.description, float(body.amount),
        pay_method, body.reference_no, expense_date,
        str(current_user["id"]), current_user.get("full_name") or "Staff"
    )
