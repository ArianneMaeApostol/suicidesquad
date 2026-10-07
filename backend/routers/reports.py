"""
routers/reports.py — Daily sales aggregations, 7-30 day analytics, and dashboard metrics using PostgreSQL.
GET /api/reports/daily
GET /api/reports/recent-daily
GET /api/reports/dashboard-metrics
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/daily")
async def get_daily_sales(
    branch_id: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    target_date = date or datetime.now().strftime("%Y-%m-%d")

    params = [target_date]
    where = "WHERE is_voided = FALSE AND to_char(created_at, 'YYYY-MM-DD') = $1"
    if bid and current_user["role"] != "owner":
        where += " AND branch_id = $2"
        params.append(str(bid))
    elif branch_id:
        where += " AND branch_id = $2"
        params.append(str(branch_id))

    sales = await db.fetch_all(f"SELECT total, payment_method FROM sales {where}", *params)

    total_sales = sum(float(s.get("total", 0)) for s in sales)
    cash_sales = sum(float(s.get("total", 0)) for s in sales if s.get("payment_method") == "cash")
    digital_sales = sum(float(s.get("total", 0)) for s in sales if s.get("payment_method") in ("gcash", "maya"))
    credit_sales = sum(float(s.get("total", 0)) for s in sales if s.get("payment_method") == "credit")

    return {
        "day": target_date,
        "total_sales": total_sales,
        "gross_sales": total_sales,
        "transactions": len(sales),
        "valid_transactions": len(sales),
        "cash_sales": cash_sales,
        "digital_sales": digital_sales,
        "credit_sales": credit_sales,
    }


@router.get("/recent-daily")
async def get_recent_daily_sales(
    branch_id: Optional[str] = Query(None),
    days: int = Query(7, ge=1, le=90),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    now = datetime.now()

    results = []
    for i in range(days - 1, -1, -1):
        d = now - timedelta(days=i)
        day_str = d.strftime("%Y-%m-%d")

        params = [day_str]
        where = "WHERE is_voided = FALSE AND to_char(created_at, 'YYYY-MM-DD') = $1"
        if bid and current_user["role"] != "owner":
            where += " AND branch_id = $2"
            params.append(str(bid))
        elif branch_id:
            where += " AND branch_id = $2"
            params.append(str(branch_id))

        row = await db.fetch_one(
            f"SELECT COALESCE(SUM(total), 0) AS total_sales, COUNT(*) AS tx_count FROM sales {where}",
            *params
        )

        results.append({
            "day": day_str,
            "total_sales": float(row["total_sales"]) if row else 0.0,
            "transactions": int(row["tx_count"]) if row else 0,
        })

    return results


@router.get("/dashboard-metrics")
async def get_dashboard_metrics(
    branch_id: Optional[str] = Query(None),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")

    # 1. Pending deliveries
    deliv_params = []
    deliv_where = "WHERE status IN ('pending', 'assigned', 'out_for_delivery')"
    if bid and current_user["role"] != "owner":
        deliv_where += " AND branch_id = $1"
        deliv_params.append(str(bid))
    elif branch_id:
        deliv_where += " AND branch_id = $1"
        deliv_params.append(str(branch_id))

    pending_count = await db.fetch_val(
        f"SELECT COUNT(*) FROM delivery_orders {deliv_where}",
        *deliv_params
    ) or 0

    # 2. Customer balances
    cust_params = []
    cust_where = "WHERE is_active = TRUE AND balance > 0"
    if bid and current_user["role"] != "owner":
        cust_where += " AND branch_id = $1"
        cust_params.append(str(bid))
    elif branch_id:
        cust_where += " AND branch_id = $1"
        cust_params.append(str(branch_id))

    cust_stats = await db.fetch_one(
        f"SELECT COALESCE(SUM(balance), 0) AS total_balance, COUNT(*) AS with_balance FROM customers {cust_where}",
        *cust_params
    )

    return {
        "pendingDeliveries": int(pending_count),
        "totalBalance": float(cust_stats["total_balance"]) if cust_stats else 0.0,
        "customersWithBalance": int(cust_stats["with_balance"]) if cust_stats else 0,
    }
