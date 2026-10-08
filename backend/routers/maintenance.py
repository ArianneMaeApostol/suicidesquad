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
    branch_id: Optional[str] = None
    ph: Optional[float] = None
    ph_level: Optional[float] = None
    tds: Optional[float] = None
    tds_ppm: Optional[float] = None
    bacteria_result: Optional[str] = "Negative"
    coliform_passed: Optional[bool] = None
    result: Optional[str] = "pass"
    status: Optional[str] = None
    certificate_path: Optional[str] = None
    attachment_url: Optional[str] = None
    laboratory: Optional[str] = "DOH Accredited Water Testing Lab"
    remarks: Optional[str] = None


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
        tests = await db.fetch_all("SELECT * FROM water_tests WHERE branch_id = $1 ORDER BY sample_date DESC, created_at DESC", str(bid))
    elif branch_id:
        tests = await db.fetch_all("SELECT * FROM water_tests WHERE branch_id = $1 ORDER BY sample_date DESC, created_at DESC", str(branch_id))
    else:
        tests = await db.fetch_all("SELECT * FROM water_tests ORDER BY sample_date DESC, created_at DESC")

    for t in tests:
        t["tds_ppm"] = t.get("tds") or 0
        t["ph_level"] = t.get("ph") or 7.0
        t["status"] = t.get("result") or ("passed" if (t.get("tds") and t.get("tds") <= 15) else "failed")
        t["attachment_url"] = t.get("certificate_path")
        t["coliform_passed"] = (t.get("bacteria_result") or "Negative").lower() == "negative"
        t["tested_at"] = t.get("created_at") or t.get("sample_date")
        t["tested_by"] = current_user.get("full_name") or "Maria Santos"
    return tests


@router.post("/water-tests", status_code=201)
async def create_water_test(
    body: WaterTestIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = body.branch_id or current_user.get("branch_id")
    ph = body.ph if body.ph is not None else body.ph_level
    tds = body.tds if body.tds is not None else body.tds_ppm

    bacteria = body.bacteria_result
    if body.coliform_passed is not None:
        bacteria = "Negative" if body.coliform_passed else "Positive"

    result = body.result or body.status or ("pass" if (tds is not None and tds <= 15) else "fail")
    cert = body.certificate_path or body.attachment_url

    query = """
        INSERT INTO water_tests (branch_id, ph, tds, bacteria_result, result, certificate_path, laboratory, remarks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    """
    created = await db.fetch_one(
        query,
        str(bid) if bid else None, ph, tds, bacteria, result, cert,
        body.laboratory or "DOH Accredited Water Testing Lab", body.remarks
    )
    if created:
        created["tds_ppm"] = created.get("tds") or 0
        created["ph_level"] = created.get("ph") or 7.0
        created["status"] = created.get("result")
        created["attachment_url"] = created.get("certificate_path")
        created["coliform_passed"] = (created.get("bacteria_result") or "Negative").lower() == "negative"
        created["tested_at"] = created.get("created_at") or created.get("sample_date")
        created["tested_by"] = current_user.get("full_name") or "Maria Santos"
    return created


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

    url_path = f"/uploads/{filename}"
    return {"path": url_path, "url": url_path, "filename": filename}
