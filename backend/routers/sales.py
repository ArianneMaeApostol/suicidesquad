"""
routers/sales.py — Sales transactions, voiding, and recent sales queries using PostgreSQL.
POST /api/sales
GET  /api/sales
POST /api/sales/{sale_id}/void
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, timezone
import random

from database import get_db, Database
from middleware.auth import get_current_user, require_roles

router = APIRouter(prefix="/api/sales", tags=["sales"])


class SaleItemIn(BaseModel):
    product_id: str
    qty: int
    unit_price: Optional[float] = None
    subtotal: Optional[float] = None
    gallons_lent: Optional[int] = 0
    gallons_returned: Optional[int] = 0


class CreateSaleIn(BaseModel):
    branch_id: str
    customer_id: Optional[str] = None
    sale_type: str = "walk_in"
    items: List[SaleItemIn]
    payment_method: str = "cash"
    amount_paid: float = 0.0
    discount: float = 0.0
    containers_lent: int = 0
    containers_back: int = 0


class VoidSaleIn(BaseModel):
    reason: Optional[str] = "Customer request / error"
    supervisor_passcode: Optional[str] = None


@router.post("", status_code=201)
async def create_sale(
    body: CreateSaleIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = await db.resolve_branch(body.branch_id, current_user)

    # 1. Find active shift if any
    active_shift = await db.fetch_one(
        "SELECT id FROM shifts WHERE branch_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1",
        bid
    )
    shift_id = active_shift["id"] if active_shift else None

    # 2. Customer tier check
    customer = None
    customer_tier = "walk_in"
    cid = body.customer_id.strip() if (body.customer_id and str(body.customer_id).strip()) else None
    if cid:
        customer = await db.fetch_one("SELECT * FROM customers WHERE id = $1", cid)
        if customer:
            customer_tier = customer.get("type", "walk_in")
        else:
            cid = None

    # 3. Resolve items and calculate subtotal
    line_items = []
    calc_subtotal = 0.0

    for item in body.items:
        prod = await db.fetch_one("SELECT * FROM products WHERE id = $1", item.product_id)
        prod_name = prod["name"] if prod else "Custom Station Item"
        prod_id = prod["id"] if prod else None

        unit_price = item.unit_price
        if unit_price is None or unit_price == 0:
            if prod:
                price_row = await db.fetch_one(
                    "SELECT price FROM product_prices WHERE product_id = $1 AND customer_type = $2",
                    prod["id"], customer_tier
                )
                unit_price = float(price_row["price"]) if price_row else 30.0
            else:
                unit_price = 30.0

        item_subtotal = item.subtotal if item.subtotal is not None else (unit_price * item.qty)
        calc_subtotal += item_subtotal

        line_items.append({
            "product_id": prod_id,
            "product_name": prod_name,
            "qty": item.qty,
            "unit_price": float(unit_price),
            "subtotal": float(item_subtotal),
            "gallons_lent": item.gallons_lent or 0,
            "gallons_returned": item.gallons_returned or 0,
        })

    total_amount = max(calc_subtotal - (body.discount or 0.0), 0.0)
    amount_paid = float(body.amount_paid) if body.payment_method != "credit" else 0.0
    change_amount = max(amount_paid - total_amount, 0.0) if body.payment_method == "cash" else 0.0

    # Generate sale number
    sale_number = f"INV-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000, 9999)}"

    # 4. Insert Sale
    sale_query = """
        INSERT INTO sales (
            sale_number, branch_id, shift_id, customer_id, cashier_id,
            sale_type, payment_method, subtotal, discount, total,
            amount_paid, change_amount, containers_lent, containers_back,
            status, is_voided
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'completed', FALSE)
        RETURNING id
    """
    sale_id = await db.fetch_val(
        sale_query,
        sale_number, bid, shift_id, cid, str(current_user["id"]),
        body.sale_type, body.payment_method, calc_subtotal, body.discount,
        total_amount, amount_paid, change_amount, body.containers_lent, body.containers_back
    )

    # 5. Insert Sale Items
    for li in line_items:
        await db.execute(
            """
            INSERT INTO sale_items (
                sale_id, product_id, product_name, qty, unit_price, subtotal,
                gallons_lent, gallons_returned
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            sale_id, li["product_id"], li["product_name"], li["qty"],
            li["unit_price"], li["subtotal"], li["gallons_lent"], li["gallons_returned"]
        )

    # 6. Customer Account and Container Ledger Updates
    if cid:
        # If paid with credit (utang), increase customer debt balance
        if body.payment_method == "credit":
            await db.execute(
                "UPDATE customers SET balance = balance + $2, updated_at = NOW() WHERE id = $1",
                cid, total_amount
            )

        # Update container balance if lent or returned
        net_containers = (body.containers_lent or 0) - (body.containers_back or 0)
        if net_containers != 0:
            await db.execute(
                "UPDATE customers SET containers_out = GREATEST(containers_out + $2, 0), updated_at = NOW() WHERE id = $1",
                cid, net_containers
            )
            curr_cust = await db.fetch_one("SELECT containers_out FROM customers WHERE id = $1", cid)
            new_bal = curr_cust["containers_out"] if curr_cust else 0
            await db.execute(
                """
                INSERT INTO container_ledger (customer_id, sale_id, container_type, quantity_change, balance_after, notes)
                VALUES ($1, $2, 'slim', $3, $4, $5)
                """,
                cid, sale_id, net_containers, new_bal, f"Sale transaction {sale_number}"
            )

    # 7. Auto-create Delivery Order if sale_type is delivery
    if body.sale_type == "delivery" and cid:
        total_gallons = sum(li["qty"] for li in line_items)
        cust_addr = customer.get("address", "") if customer else ""
        cust_brgy = customer.get("barangay", "") if customer else ""
        await db.execute(
            """
            INSERT INTO delivery_orders (
                branch_id, customer_id, sale_id, status, delivery_address,
                barangay, gallons, amount, payment_method, is_paid
            )
            VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9)
            """,
            bid, cid, sale_id, cust_addr, cust_brgy,
            total_gallons, total_amount, body.payment_method, (body.payment_method != "credit")
        )

    # 8. Automatic Consumables & Stock Inventory Deductions
    total_refill_units = sum(li["qty"] for li in line_items if "refill" in li["product_name"].lower() or "gal" in li["product_name"].lower())
    if total_refill_units > 0:
        # Deduct Caps
        cap_item = await db.fetch_one(
            "SELECT id, quantity FROM inventory_items WHERE branch_id = $1 AND (category = 'cap' OR name ILIKE '%cap%') ORDER BY quantity DESC LIMIT 1",
            bid
        )
        if cap_item:
            await db.execute(
                "UPDATE inventory_items SET quantity = GREATEST(quantity - $2, 0), updated_at = NOW() WHERE id = $1",
                cap_item["id"], float(total_refill_units)
            )
            await db.execute(
                "INSERT INTO inventory_movements (branch_id, item_id, type, qty, note) VALUES ($1, $2, 'out', $3, $4)",
                bid, cap_item["id"], float(total_refill_units), f"POS Refill Caps: {sale_number}"
            )

        # Deduct Seals
        seal_item = await db.fetch_one(
            "SELECT id, quantity FROM inventory_items WHERE branch_id = $1 AND (category = 'seal' OR name ILIKE '%seal%') ORDER BY quantity DESC LIMIT 1",
            bid
        )
        if seal_item:
            await db.execute(
                "UPDATE inventory_items SET quantity = GREATEST(quantity - $2, 0), updated_at = NOW() WHERE id = $1",
                seal_item["id"], float(total_refill_units)
            )
            await db.execute(
                "INSERT INTO inventory_movements (branch_id, item_id, type, qty, note) VALUES ($1, $2, 'out', $3, $4)",
                bid, seal_item["id"], float(total_refill_units), f"POS Refill Seals: {sale_number}"
            )

    # Deduct Empty Bottles if new container was sold
    total_bottle_units = sum(li["qty"] for li in line_items if "container" in li["product_name"].lower() or "bottle" in li["product_name"].lower() or "dispenser" in li["product_name"].lower())
    if total_bottle_units > 0:
        bottle_item = await db.fetch_one(
            "SELECT id, quantity FROM inventory_items WHERE branch_id = $1 AND (category = 'container' OR name ILIKE '%bottle%' OR name ILIKE '%container%') ORDER BY quantity DESC LIMIT 1",
            bid
        )
        if bottle_item:
            await db.execute(
                "UPDATE inventory_items SET quantity = GREATEST(quantity - $2, 0), updated_at = NOW() WHERE id = $1",
                bottle_item["id"], float(total_bottle_units)
            )
            await db.execute(
                "INSERT INTO inventory_movements (branch_id, item_id, type, qty, note) VALUES ($1, $2, 'out', $3, $4)",
                bid, bottle_item["id"], float(total_bottle_units), f"POS Container Sale: {sale_number}"
            )

    return str(sale_id)


@router.get("")
async def list_sales(
    branch_id: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    bid = branch_id or current_user.get("branch_id")
    params = []
    where = "WHERE s.is_voided = FALSE"
    if bid and current_user["role"] != "owner":
        where += " AND s.branch_id = $1"
        params.append(str(bid))
    elif branch_id:
        where += " AND s.branch_id = $1"
        params.append(str(branch_id))

    params.append(limit)
    limit_idx = len(params)

    query = f"""
        SELECT s.*, c.full_name AS customer_name, u.full_name AS cashier_name
        FROM sales s
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN users u ON s.cashier_id = u.id
        {where}
        ORDER BY s.created_at DESC
        LIMIT ${limit_idx}
    """
    sales = await db.fetch_all(query, *params)
    sales_list = []
    for s in sales:
        s_dict = dict(s)
        s_dict["customer"] = {"full_name": s.get("customer_name") or "Walk-in Customer"}
        items = await db.fetch_all("SELECT * FROM sale_items WHERE sale_id = $1", s_dict["id"])
        s_dict["items"] = [dict(it) for it in items]
        sales_list.append(s_dict)
    return sales_list


@router.post("/{sale_id}/void")
async def void_sale(
    sale_id: str,
    body: VoidSaleIn,
    db: Database = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    sale = await db.fetch_one("SELECT * FROM sales WHERE id = $1", sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.get("is_voided"):
        raise HTTPException(status_code=400, detail="Sale is already voided")

    # Verify authorization: Owner/Manager role or valid Supervisor Passcode
    is_authorized = current_user.get("role") in ("owner", "manager")
    if not is_authorized:
        if body.supervisor_passcode:
            # Check default supervisor PINs
            if body.supervisor_passcode in ("1234", "admin123", "password123"):
                is_authorized = True
            else:
                try:
                    import bcrypt
                    mgr_hashes = await db.fetch_all(
                        "SELECT password_hash FROM users WHERE role IN ('owner', 'manager') AND is_active = TRUE"
                    )
                    for mh in mgr_hashes:
                        if bcrypt.checkpw(body.supervisor_passcode.encode("utf-8"), mh["password_hash"].encode("utf-8")):
                            is_authorized = True
                            break
                except Exception:
                    pass

        if not is_authorized:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Voiding transactions requires Manager / Owner role or valid Supervisor PIN (Default PIN: 1234)."
            )

    # 1. Mark voided in sales table
    await db.execute(
        """
        UPDATE sales
        SET is_voided = TRUE, status = 'voided', void_reason = $2
        WHERE id = $1
        """,
        sale_id, body.reason
    )

    # 2. Revert customer balance if credit sale
    if sale.get("payment_method") == "credit" and sale.get("customer_id"):
        await db.execute(
            "UPDATE customers SET balance = GREATEST(balance - $2, 0), updated_at = NOW() WHERE id = $1",
            sale["customer_id"], float(sale.get("total", 0.0))
        )

    # 3. Revert container balances
    net_containers = (sale.get("containers_lent") or 0) - (sale.get("containers_back") or 0)
    if net_containers != 0 and sale.get("customer_id"):
        await db.execute(
            "UPDATE customers SET containers_out = GREATEST(containers_out - $2, 0), updated_at = NOW() WHERE id = $1",
            sale["customer_id"], net_containers
        )
        curr_cust = await db.fetch_one("SELECT containers_out FROM customers WHERE id = $1", sale["customer_id"])
        new_bal = curr_cust["containers_out"] if curr_cust else 0
        await db.execute(
            """
            INSERT INTO container_ledger (customer_id, sale_id, container_type, quantity_change, balance_after, notes)
            VALUES ($1, $2, 'slim', $3, $4, $5)
            """,
            sale["customer_id"], sale_id, -net_containers, new_bal, f"Revert Voided Sale {sale.get('sale_number')}"
        )

    # 4. Revert inventory consumables & container stock deductions
    sale_number = sale.get("sale_number")
    if sale_number:
        deducted_movements = await db.fetch_all(
            "SELECT * FROM inventory_movements WHERE note LIKE $1 AND type = 'out'",
            f"%{sale_number}%"
        )
        for mov in deducted_movements:
            await db.execute(
                "UPDATE inventory_items SET quantity = quantity + $2, updated_at = NOW() WHERE id = $1",
                mov["item_id"], float(mov["qty"])
            )
            await db.execute(
                "INSERT INTO inventory_movements (branch_id, item_id, type, qty, note) VALUES ($1, $2, 'in', $3, $4)",
                mov["branch_id"], mov["item_id"], float(mov["qty"]), f"Revert Voided Sale: {sale_number}"
            )

    return {
        "message": "Sale voided successfully and inventory restored",
        "sale_id": str(sale_id),
        "sale_number": sale_number
    }

