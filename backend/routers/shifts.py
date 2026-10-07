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
    query = """
        UPDATE shifts
        SET closed_at = NOW(),
            closing_cash = $2,
            notes = $3
        WHERE id = $1 AND closed_at IS NULL
        RETURNING *
    """
    closed = await db.fetch_one(
        query,
        body.shift_id, float(body.counted_cash), body.notes
    )
    if not closed:
        raise HTTPException(status_code=400, detail="Shift not found or already closed")

    return closed
