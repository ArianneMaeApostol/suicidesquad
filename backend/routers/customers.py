"""
routers/customers.py — Customer CRUD and account ledgers using PostgreSQL.
GET    /api/customers          (paginated, search, type filter)
POST   /api/customers
GET    /api/customers/{id}
PATCH  /api/customers/{id}
GET    /api/customers/{id}/transactions
GET    /api/customers/{id}/container-ledger
GET    /api/customers/{id}/payments
POST   /api/customers/{id}/payments
"""
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List

from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/customers", tags=["customers"])

CUSTOMER_TYPES = {"walk_in", "regular", "reseller", "commercial"}
PAYMENT_METHODS = {"cash", "gcash", "maya", "credit", "prepaid"}


class CustomerIn(BaseModel):
    full_name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    barangay: Optional[str] = None
    type: str = "walk_in"
    credit_limit: float = 0.0
    notes: Optional[str] = None


class CustomerUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    barangay: Optional[str] = None
    type: Optional[str] = None
    credit_limit: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CustomerPaymentIn(BaseModel):
    amount: float
    method: str = "cash"
    reference: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
async def list_customers(
    search: str = Query("", alias="search"),
    type: str = Query("all", alias="type"),
    page: int = Query(1, ge=1),
    limit: int = Query(15, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    conditions = ["is_active = TRUE"]
    params = []
    idx = 1

    if current_user["role"] != "owner":
        bid = current_user.get("branch_id")
        if bid:
            conditions.append(f"(branch_id = ${idx} OR branch_id IS NULL)")
            params.append(str(bid))
            idx += 1

    if type and type != "all" and type in CUSTOMER_TYPES:
        conditions.append(f"type = ${idx}")
        params.append(type)
        idx += 1

    if search.strip():
        term = f"%{search.strip()}%"
        conditions.append(f"(full_name ILIKE ${idx} OR phone ILIKE ${idx} OR address ILIKE ${idx})")
        params.append(term)
        idx += 1

    where_clause = " WHERE " + " AND ".join(conditions)

    count_query = f"SELECT COUNT(*) FROM customers {where_clause}"
    total = await db.fetch_val(count_query, *params) or 0

    offset = (page - 1) * limit
    data_query = f"""
        SELECT * FROM customers
        {where_clause}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])
    docs = await db.fetch_all(data_query, *params)

    return {"data": docs, "total": int(total), "page": page, "limit": limit}


@router.post("", status_code=201)
async def create_customer(
    body: CustomerIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = current_user.get("branch_id")
    query = """
        INSERT INTO customers (
            branch_id, full_name, phone, address, barangay, type,
            balance, credit_limit, containers_out, notes, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0.0, $7, 0, $8, TRUE)
        RETURNING *
    """
    customer = await db.fetch_one(
        query,
        bid, body.full_name, body.phone, body.address, body.barangay,
        body.type, float(body.credit_limit), body.notes
    )
    return customer


@router.get("/{customer_id}")
async def get_customer(
    customer_id: str,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    cust = await db.fetch_one("SELECT * FROM customers WHERE id = $1", customer_id)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    return cust


@router.patch("/{customer_id}")
async def update_customer(
    customer_id: str,
    body: CustomerUpdate,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    cust = await db.fetch_one("SELECT * FROM customers WHERE id = $1", customer_id)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    query = """
        UPDATE customers
        SET full_name = COALESCE($2, full_name),
            phone = COALESCE($3, phone),
            address = COALESCE($4, address),
            barangay = COALESCE($5, barangay),
            type = COALESCE($6, type),
            credit_limit = COALESCE($7, credit_limit),
            notes = COALESCE($8, notes),
            is_active = COALESCE($9, is_active),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
    """
    updated = await db.fetch_one(
        query,
        customer_id, body.full_name, body.phone, body.address, body.barangay,
        body.type, body.credit_limit, body.notes, body.is_active
    )
    return updated


@router.get("/{customer_id}/transactions")
async def get_customer_transactions(
    customer_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT * FROM sales
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2
    """
    return await db.fetch_all(query, customer_id, limit)


@router.get("/{customer_id}/container-ledger")
async def get_container_ledger(
    customer_id: str,
    limit: int = Query(50, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT * FROM container_ledger
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2
    """
    return await db.fetch_all(query, customer_id, limit)


@router.get("/{customer_id}/payments")
async def get_customer_payments(
    customer_id: str,
    limit: int = Query(50, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT * FROM payments
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2
    """
    return await db.fetch_all(query, customer_id, limit)


@router.post("/{customer_id}/payments", status_code=201)
async def post_customer_payment(
    customer_id: str,
    body: CustomerPaymentIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    cust = await db.fetch_one("SELECT * FROM customers WHERE id = $1", customer_id)
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")

    bid = cust.get("branch_id") or current_user.get("branch_id")
    amt = float(body.amount)

    payment_query = """
        INSERT INTO payments (
            customer_id, customer_name, branch_id, cashier_id, cashier_name,
            amount, payment_method, reference_no, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
    """
    payment = await db.fetch_one(
        payment_query,
        customer_id, cust["full_name"], bid, str(current_user["id"]),
        current_user.get("full_name"), amt, body.method, body.reference, body.notes
    )

    # Adjust balance (credit payment reduces positive outstanding debt)
    await db.execute(
        "UPDATE customers SET balance = balance - $2, updated_at = NOW() WHERE id = $1",
        customer_id, amt
    )

    return payment
