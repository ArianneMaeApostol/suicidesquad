"""
routers/branches.py — Branch CRUD using PostgreSQL
GET    /api/branches
POST   /api/branches
PATCH  /api/branches/{branch_id}
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional

from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/branches", tags=["branches"])


class BranchIn(BaseModel):
    name: str
    address: Optional[str] = None
    barangay: Optional[str] = None
    city: str = "Pasig City"
    province: str = "Metro Manila"
    phone: Optional[str] = None
    tin: Optional[str] = None


@router.get("")
async def list_branches(
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] == "owner":
        return await db.fetch_all("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name ASC")
    else:
        bid = current_user.get("branch_id")
        if not bid:
            return []
        return await db.fetch_all("SELECT * FROM branches WHERE id = $1", str(bid))


@router.post("", status_code=201)
async def create_branch(
    body: BranchIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner"),
):
    query = """
        INSERT INTO branches (name, address, barangay, city, province, phone, tin, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
        RETURNING *
    """
    created = await db.fetch_one(
        query,
        body.name, body.address, body.barangay, body.city, body.province, body.phone, body.tin
    )
    return created


@router.patch("/{branch_id}")
async def update_branch(
    branch_id: str,
    body: BranchIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner"),
):
    query = """
        UPDATE branches
        SET name = COALESCE($2, name),
            address = COALESCE($3, address),
            barangay = COALESCE($4, barangay),
            city = COALESCE($5, city),
            province = COALESCE($6, province),
            phone = COALESCE($7, phone),
            tin = COALESCE($8, tin)
        WHERE id = $1
        RETURNING *
    """
    updated = await db.fetch_one(
        query,
        branch_id, body.name, body.address, body.barangay, body.city, body.province, body.phone, body.tin
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Branch not found")
    return updated
