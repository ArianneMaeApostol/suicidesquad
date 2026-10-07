"""
routers/maintenance.py — Equipment, maintenance tasks, DOH water tests, compliance permits, and file uploads using PostgreSQL.
GET   /api/maintenance/equipment
POST  /api/maintenance/equipment
GET   /api/maintenance/tasks
POST  /api/maintenance/tasks
PATCH /api/maintenance/tasks/{id}/complete
GET   /api/maintenance/upcoming
GET   /api/maintenance/water-tests
POST  /api/maintenance/water-tests
GET   /api/maintenance/permits
GET   /api/maintenance/permits/expiring
POST  /api/maintenance/upload
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from pydantic import BaseModel
from typing import Optional, List
import os
import shutil

from config import UPLOADS_DIR
from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


class EquipmentIn(BaseModel):
    branch_id: str
    name: str
    model: Optional[str] = None
    serial_no: Optional[str] = None
    installed_at: Optional[str] = None
    last_serviced: Optional[str] = None
    next_service: Optional[str] = None
    status: str = "operational"
    notes: Optional[str] = None


class MaintenanceTaskIn(BaseModel):
    branch_id: str
    equipment_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    due_date: str


class WaterTestIn(BaseModel):
    branch_id: str
    ph: Optional[float] = None
    tds: Optional[float] = None
    bacteria_result: Optional[str] = "Negative"
    result: str = "pass"
    certificate_path: Optional[str] = None


class PermitIn(BaseModel):
    branch_id: str
    name: str
    issuer: Optional[str] = "DOH / LGU"
    issued_at: Optional[str] = None
    expires_at: str
    file_path: Optional[str] = None
    notes: Optional[str] = None


@router.get("/equipment")
async def list_equipment(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    if bid and current_user["role"] != "owner":
        return await db.fetch_all("SELECT * FROM equipment WHERE branch_id = $1 ORDER BY name ASC", str(bid))
    elif branch_id:
        return await db.fetch_all("SELECT * FROM equipment WHERE branch_id = $1 ORDER BY name ASC", str(branch_id))
    return await db.fetch_all("SELECT * FROM equipment ORDER BY name ASC")


@router.post("/equipment", status_code=201)
async def create_equipment(
    body: EquipmentIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        INSERT INTO equipment (branch_id, name, model, serial_no, status, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
    """
    return await db.fetch_one(
        query,
        body.branch_id, body.name, body.model, body.serial_no, body.status, body.notes
    )


@router.get("/tasks")
async def list_tasks(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = ""
    if bid and current_user["role"] != "owner":
        where = "WHERE t.branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where = "WHERE t.branch_id = $1"
        params.append(str(branch_id))

    query = f"""
        SELECT t.*, e.name AS equipment_name
        FROM maintenance_tasks t
        LEFT JOIN equipment e ON t.equipment_id = e.id
        {where}
        ORDER BY t.due_date ASC
    """
    tasks = await db.fetch_all(query, *params)
    for t in tasks:
        t["equipment"] = {"name": t.get("equipment_name") or "Main System"}
    return tasks


@router.post("/tasks", status_code=201)
async def create_task(
    body: MaintenanceTaskIn,
    db: Database = Depends(get_db),
    _: dict = require_roles("owner", "manager"),
):
    query = """
        INSERT INTO maintenance_tasks (branch_id, equipment_id, title, description, due_date, status)
        VALUES ($1, $2, $3, $4, $5::date, 'pending')
        RETURNING *
    """
    return await db.fetch_one(
        query,
        body.branch_id, body.equipment_id, body.title, body.description, body.due_date
    )


@router.patch("/tasks/{task_id}/complete")
async def complete_task(
    task_id: str,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = """
        UPDATE maintenance_tasks
        SET status = 'completed', completed_at = NOW(), technician_name = $2
        WHERE id = $1
        RETURNING *
    """
    task = await db.fetch_one(query, task_id, current_user.get("full_name", "Operator"))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/upcoming")
async def get_upcoming_maintenance(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = "WHERE t.status = 'pending'"
    if bid and current_user["role"] != "owner":
        where += " AND t.branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where += " AND t.branch_id = $1"
        params.append(str(branch_id))

    query = f"""
        SELECT t.*, e.name AS equipment_name
        FROM maintenance_tasks t
        LEFT JOIN equipment e ON t.equipment_id = e.id
        {where}
        ORDER BY t.due_date ASC
        LIMIT 10
    """
    tasks = await db.fetch_all(query, *params)
    for t in tasks:
        t["equipment"] = {"name": t.get("equipment_name") or "Water Filter Array"}
    return tasks


@router.get("/water-tests")
async def list_water_tests(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    if bid and current_user["role"] != "owner":
        return await db.fetch_all("SELECT * FROM water_tests WHERE branch_id = $1 ORDER BY sample_date DESC", str(bid))
    elif branch_id:
        return await db.fetch_all("SELECT * FROM water_tests WHERE branch_id = $1 ORDER BY sample_date DESC", str(branch_id))
    return await db.fetch_all("SELECT * FROM water_tests ORDER BY sample_date DESC")


@router.post("/water-tests", status_code=201)
async def create_water_test(
    body: WaterTestIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = """
        INSERT INTO water_tests (branch_id, ph, tds, bacteria_result, result, certificate_path)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
    """
    return await db.fetch_one(
        query,
        body.branch_id, body.ph, body.tds, body.bacteria_result, body.result, body.certificate_path
    )


@router.get("/permits")
async def list_permits(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    if bid and current_user["role"] != "owner":
        return await db.fetch_all("SELECT * FROM permits WHERE branch_id = $1 ORDER BY expires_at ASC", str(bid))
    elif branch_id:
        return await db.fetch_all("SELECT * FROM permits WHERE branch_id = $1 ORDER BY expires_at ASC", str(branch_id))
    return await db.fetch_all("SELECT * FROM permits ORDER BY expires_at ASC")


@router.get("/permits/expiring")
async def get_expiring_permits(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = "WHERE expires_at <= CURRENT_DATE + INTERVAL '60 days'"
    if bid and current_user["role"] != "owner":
        where += " AND branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where += " AND branch_id = $1"
        params.append(str(branch_id))

    query = f"SELECT * FROM permits {where} ORDER BY expires_at ASC"
    return await db.fetch_all(query, *params)


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    filename = f"{current_user.get('branch_id', 'general')}_{file.filename}"
    filepath = os.path.join(UPLOADS_DIR, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"path": f"/uploads/{filename}", "filename": filename}
