"""
routers/shifts.py — POS Shift Management using PostgreSQL
GET   /api/shifts/active
POST  /api/shifts/open
POST  /api/shifts/close
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/shifts", tags=["shifts"])


class OpenShiftIn(BaseModel):
    branch_id: str
    opening_cash: float = 0.0


class CloseShiftIn(BaseModel):
    shift_id: str
    counted_cash: float = 0.0
    notes: Optional[str] = None


async def _resolve_branch_id(db: Database, bid: str, current_user: dict) -> str:
    if not bid:
        return current_user.get("branch_id") or ""
    found = await db.fetch_one("SELECT id FROM branches WHERE id = $1", str(bid))
    if found:
        return found["id"]
    found = await db.fetch_one(
        "SELECT id FROM branches WHERE name ILIKE $1 OR city ILIKE $1 OR barangay ILIKE $1 LIMIT 1",
        f"%{bid}%"
    )
    if found:
        return found["id"]
    if current_user.get("branch_id"):
        return current_user["branch_id"]
    first = await db.fetch_one("SELECT id FROM branches WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1")
    return first["id"] if first else str(bid)


@router.get("/active")
async def get_active_shift(
    branch_id: str = Query(...),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = await _resolve_branch_id(db, branch_id, current_user)
    query = """
        SELECT * FROM shifts
        WHERE branch_id = $1 AND closed_at IS NULL
        ORDER BY opened_at DESC
        LIMIT 1
    """
    shift = await db.fetch_one(query, bid)
    return shift


@router.post("/open", status_code=201)
async def open_shift(
    body: OpenShiftIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = await _resolve_branch_id(db, body.branch_id, current_user)

    # Check if active shift already exists
    existing = await db.fetch_one(
        "SELECT id FROM shifts WHERE branch_id = $1 AND closed_at IS NULL",
        bid
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A shift is already open for this branch"
        )

    query = """
        INSERT INTO shifts (branch_id, cashier_id, opened_at, opening_cash)
        VALUES ($1, $2, NOW(), $3)
        RETURNING id
    """
    shift_id = await db.fetch_val(
        query,
        bid, str(current_user["id"]), float(body.opening_cash)
    )
    return str(shift_id)


@router.post("/close")
async def close_shift(
    body: CloseShiftIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    shift = await db.fetch_one("SELECT * FROM shifts WHERE id = $1 AND closed_at IS NULL", body.shift_id)
    if not shift:
        raise HTTPException(status_code=400, detail="Shift not found or already closed")

    opening_cash = float(shift.get("opening_cash") or 0.0)
    cash_sales = await db.fetch_val(
        """
        SELECT COALESCE(SUM(total), 0) FROM sales
        WHERE shift_id = $1 AND payment_method = 'cash' AND is_voided = FALSE
        """,
        body.shift_id
    )
    expected_cash = opening_cash + float(cash_sales or 0.0)
    cash_variance = float(body.counted_cash) - expected_cash

    query = """
        UPDATE shifts
        SET closed_at = NOW(),
            closing_cash = $2,
            expected_cash = $3,
            cash_variance = $4,
            notes = $5
        WHERE id = $1 AND closed_at IS NULL
        RETURNING *
    """
    closed = await db.fetch_one(
        query,
        body.shift_id, float(body.counted_cash), expected_cash, cash_variance, body.notes
    )
    if not closed:
        raise HTTPException(status_code=400, detail="Shift could not be closed")

    res = dict(closed)
    res["variance"] = cash_variance
    return res
