"""
routers/users.py — Operator accounts and role permissions using PostgreSQL.
GET   /api/users
PATCH /api/users/{id}
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional

from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/users", tags=["users"])


class UserUpdateIn(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    full_name: Optional[str] = None
    branch_id: Optional[str] = None


@router.get("")
async def list_users(
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        SELECT u.id, u.branch_id, u.email, u.full_name, u.role, u.phone, u.is_active, u.created_at,
               b.name AS branch_name
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        ORDER BY u.created_at DESC
    """
    users = await db.fetch_all(query)
    for u in users:
        u["branches"] = {"name": u.get("branch_name") or "All Branches"}
    return users


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdateIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        UPDATE users
        SET role = COALESCE($2, role),
            is_active = COALESCE($3, is_active),
            full_name = COALESCE($4, full_name),
            branch_id = COALESCE($5, branch_id),
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, branch_id, email, full_name, role, phone, is_active, created_at, updated_at
    """
    updated = await db.fetch_one(
        query,
        user_id, body.role, body.is_active, body.full_name, body.branch_id
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return updated
