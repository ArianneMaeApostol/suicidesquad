"""
seed.py — Database seeder for AquaFlow WRSMS using PostgreSQL.
Populates branches, users for all 4 roles, products with tier pricing,
sample customers, inventory, equipment, permits, and test logs.

Run with: backend/venv/bin/python backend/seed.py
"""
import asyncio
import asyncpg
import bcrypt
from datetime import datetime, timezone, timedelta, date
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import DATABASE_URL


def hash_pw(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


async def seed():
    print(f"Connecting to PostgreSQL at {DATABASE_URL}...")
    conn = None
    for attempt in range(1, 11):
        try:
            conn = await asyncpg.connect(DATABASE_URL)
            break
        except Exception as e:
            if attempt == 10:
                raise
            print(f"Database not ready yet (attempt {attempt}/10: {e}). Retrying in 2s...")
            await asyncio.sleep(2)

    # 1. Ensure Schema
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    if os.path.exists(schema_path):
        with open(schema_path, "r", encoding="utf-8") as f:
            await conn.execute(f.read())

    # Check if database is already initialized
    user_count = await conn.fetchval("SELECT COUNT(*) FROM users;")
    force = "--force" in sys.argv
    if user_count > 0 and not force:
        print(f"Database already contains {user_count} users. Skipping seed (use --force to re-seed).")
        await conn.close()
        return

    print("Cleaning existing seed records...")
    await conn.execute("""
        TRUNCATE TABLE container_ledger, sale_items, sales, delivery_orders,
                       payments, shifts, product_prices, products, inventory_movements,
                       inventory_items, suppliers, maintenance_tasks, water_tests,
                       permits, expenses, equipment, customers, users, branches
        CASCADE;
    """)

    # 2. Branches
    print("Creating branches...")
    b1_id = await conn.fetchval("""
        INSERT INTO branches (name, address, barangay, city, province, phone, tin, is_active)
        VALUES ('AquaFlow Pasig Main', '128 Shaw Boulevard, Barangay Kapitolyo', 'Kapitolyo', 'Pasig City', 'Metro Manila', '+63 917 123 4567', '123-456-789-000', TRUE)
        RETURNING id;
    """)

    b2_id = await conn.fetchval("""
        INSERT INTO branches (name, address, barangay, city, province, phone, tin, is_active)
        VALUES ('AquaFlow Cainta Branch', '45 Ortigas Avenue Extension', 'San Isidro', 'Cainta', 'Rizal', '+63 918 765 4321', '123-456-789-001', TRUE)
        RETURNING id;
    """)

    # 3. Users (password: password123)
    print("Creating demo users (password: password123)...")
    pw = hash_pw("password123")

    owner_id = await conn.fetchval("""
        INSERT INTO users (branch_id, email, password_hash, full_name, role, phone, is_active)
        VALUES ($1, 'maria.santos@aquaflow.ph', $2, 'Maria Santos', 'owner', '+63 917 111 2222', TRUE)
        RETURNING id;
    """, b1_id, pw)

    manager_id = await conn.fetchval("""
        INSERT INTO users (branch_id, email, password_hash, full_name, role, phone, is_active)
        VALUES ($1, 'juan.delacruz@aquaflow.ph', $2, 'Juan Dela Cruz', 'manager', '+63 917 333 4444', TRUE)
        RETURNING id;
    """, b1_id, pw)

    cashier_id = await conn.fetchval("""
        INSERT INTO users (branch_id, email, password_hash, full_name, role, phone, is_active)
        VALUES ($1, 'head.cashier@aquaflow.ph', $2, 'Ana Reyes', 'cashier', '+63 917 555 6666', TRUE)
        RETURNING id;
    """, b1_id, pw)

    rider_id = await conn.fetchval("""
        INSERT INTO users (branch_id, email, password_hash, full_name, role, phone, is_active)
        VALUES ($1, 'rider.pasig@aquaflow.ph', $2, 'Ramon Ramos', 'rider', '+63 917 777 8888', TRUE)
        RETURNING id;
    """, b1_id, pw)

    # 4. Products & Price Tiers
    print("Creating products and tier prices...")
    p1_id = await conn.fetchval("""
        INSERT INTO products (branch_id, name, category, unit, is_container, container_type, description, is_active)
        VALUES (NULL, 'Purified Water Refill (5 Gal)', 'refill', 'gallon', FALSE, 'none', 'Standard multi-stage filtered purified drinking water', TRUE)
        RETURNING id;
    """)
    for c_type, price in [("walk_in", 30.0), ("regular", 28.0), ("reseller", 22.0), ("commercial", 25.0)]:
        await conn.execute("INSERT INTO product_prices (product_id, customer_type, price) VALUES ($1, $2, $3)", p1_id, c_type, price)

    p2_id = await conn.fetchval("""
        INSERT INTO products (branch_id, name, category, unit, is_container, container_type, description, is_active)
        VALUES (NULL, 'Alkaline Ionized Refill (5 Gal)', 'refill', 'gallon', FALSE, 'none', 'High-pH 8.5+ mineralized and hydrogen-rich water', TRUE)
        RETURNING id;
    """)
    for c_type, price in [("walk_in", 45.0), ("regular", 40.0), ("reseller", 32.0), ("commercial", 35.0)]:
        await conn.execute("INSERT INTO product_prices (product_id, customer_type, price) VALUES ($1, $2, $3)", p2_id, c_type, price)

    p3_id = await conn.fetchval("""
        INSERT INTO products (branch_id, name, category, unit, is_container, container_type, description, is_active)
        VALUES (NULL, 'Mineral Water Refill (5 Gal)', 'refill', 'gallon', FALSE, 'none', 'Natural mineral enriched healthy water', TRUE)
        RETURNING id;
    """)
    for c_type, price in [("walk_in", 35.0), ("regular", 30.0), ("reseller", 25.0), ("commercial", 28.0)]:
        await conn.execute("INSERT INTO product_prices (product_id, customer_type, price) VALUES ($1, $2, $3)", p3_id, c_type, price)

    p4_id = await conn.fetchval("""
        INSERT INTO products (branch_id, name, category, unit, is_container, container_type, description, is_active)
        VALUES (NULL, 'New Slim Container 5-Gal w/ Faucet', 'container', 'piece', TRUE, 'slim', 'Food-grade polycarbonate blue slim bottle', TRUE)
        RETURNING id;
    """)
    for c_type in ["walk_in", "regular", "reseller", "commercial"]:
        await conn.execute("INSERT INTO product_prices (product_id, customer_type, price) VALUES ($1, $2, 220.0)", p4_id, c_type)

    p5_id = await conn.fetchval("""
        INSERT INTO products (branch_id, name, category, unit, is_container, container_type, description, is_active)
        VALUES (NULL, 'New Round Container 5-Gal Dispenser', 'container', 'piece', TRUE, 'round', 'Food-grade round bottle with non-spill cap', TRUE)
        RETURNING id;
    """)
    for c_type in ["walk_in", "regular", "reseller", "commercial"]:
        await conn.execute("INSERT INTO product_prices (product_id, customer_type, price) VALUES ($1, $2, 200.0)", p5_id, c_type)

    # 5. Customers
    print("Creating sample customers...")
    c1_id = await conn.fetchval("""
        INSERT INTO customers (branch_id, full_name, phone, address, barangay, type, balance, credit_limit, containers_out, notes, is_active)
        VALUES ($1, 'Aling Nena Variety Store', '+63 920 123 9876', '12 Brixton St.', 'Kapitolyo', 'reseller', 450.0, 2000.0, 12, 'Weekly reseller with container ledger', TRUE)
        RETURNING id;
    """, b1_id)

    c2_id = await conn.fetchval("""
        INSERT INTO customers (branch_id, full_name, phone, address, barangay, type, balance, credit_limit, containers_out, notes, is_active)
        VALUES ($1, 'Kapitolyo Condominium Assoc.', '+63 917 888 7777', 'Tower 2 Admin Office, Pioneer St.', 'Kapitolyo', 'commercial', 0.0, 5000.0, 25, 'Bi-weekly 20-bottle delivery', TRUE)
        RETURNING id;
    """, b1_id)

    c3_id = await conn.fetchval("""
        INSERT INTO customers (branch_id, full_name, phone, address, barangay, type, balance, credit_limit, containers_out, notes, is_active)
        VALUES ($1, 'Elena Mercado', '+63 915 444 3322', '45 West Capitol Drive', 'Kapitolyo', 'regular', 0.0, 500.0, 2, 'Household regular, prefers alkaline', TRUE)
        RETURNING id;
    """, b1_id)

    c4_id = await conn.fetchval("""
        INSERT INTO customers (branch_id, full_name, phone, address, barangay, type, balance, credit_limit, containers_out, notes, is_active)
        VALUES ($1, 'Walk-in Cash Customer', '+63 000 000 0000', 'Station Counter', 'Kapitolyo', 'walk_in', 0.0, 0.0, 0, 'Generic retail walk-in customer', TRUE)
        RETURNING id;
    """, b1_id)

    # 6. Shift
    print("Creating active shifts...")
    shift_id = await conn.fetchval("""
        INSERT INTO shifts (branch_id, cashier_id, opened_at, opening_cash)
        VALUES ($1, $2, NOW() - INTERVAL '3 hours', 1500.0)
        RETURNING id;
    """, b1_id, cashier_id)

    await conn.execute("""
        INSERT INTO shifts (branch_id, cashier_id, opened_at, opening_cash)
        VALUES ($1, $2, NOW() - INTERVAL '2 hours', 1200.0);
    """, b2_id, cashier_id)

    # 7. Suppliers & Inventory Items
    print("Creating inventory items...")
    sup_id = await conn.fetchval("""
        INSERT INTO suppliers (branch_id, name, contact, phone, address, supplies_provided)
        VALUES ($1, 'AquaPro Supply Corp', 'Dennis Tan', '+63 917 555 0101', 'Valenzuela City', 'Bottles, Caps, Micron Filters, UV Lamps')
        RETURNING id;
    """, b1_id)

    await conn.execute("""
        INSERT INTO inventory_items (branch_id, supplier_id, name, category, unit, quantity, reorder_point, cost_per_unit)
        VALUES ($1, $2, '5-Micron Sediment Filter (20-inch)', 'filter', 'pcs', 14, 5, 120.0),
               ($1, $2, 'Carbon Block CTO Filter (20-inch)', 'filter', 'pcs', 8, 4, 250.0),
               ($1, $2, 'Non-Spill Caps (Blue)', 'cap', 'pcs', 1200, 300, 1.25),
               ($1, $2, 'Heat Shrink Seal Bands', 'seal', 'pcs', 2500, 500, 0.35),
               ($1, $2, 'Slim 5-Gal Empty Bottles', 'container', 'pcs', 45, 15, 160.0);
    """, b1_id, sup_id)

    # 8. Equipment & Maintenance Tasks
    print("Creating equipment & maintenance logs...")
    eq1_id = await conn.fetchval("""
        INSERT INTO equipment (branch_id, name, model, serial_no, status, notes)
        VALUES ($1, 'Reverse Osmosis Multi-Membrane 1000GPD', 'RO-1000GPD-PRO', 'SN-RO-2025-089', 'operational', 'Cleaned last month')
        RETURNING id;
    """, b1_id)

    await conn.execute("""
        INSERT INTO maintenance_tasks (branch_id, equipment_id, title, description, due_date, status, technician_name, cost)
        VALUES ($1, $2, 'Sediment Pre-filter Replacement', 'Replace 5-micron and 1-micron spun pre-filters', CURRENT_DATE + INTERVAL '5 days', 'pending', 'Service Tech', 350.0),
               ($1, $2, 'UV Sterilizer Quartz Sleeve Cleaning', 'Clean internal quartz sleeve to ensure 254nm transmittance', CURRENT_DATE + INTERVAL '12 days', 'pending', 'Service Tech', 500.0);
    """, b1_id, eq1_id)

    # 9. Water Tests (DOH)
    print("Creating DOH water test logs...")
    await conn.execute("""
        INSERT INTO water_tests (branch_id, sample_date, ph, tds, bacteria_result, result, laboratory, remarks)
        VALUES ($1, CURRENT_DATE - INTERVAL '15 days', 7.4, 18.0, 'Negative for E. coli & Coliforms', 'pass', 'Metropolitan Water Quality Laboratory', 'DOH PNSDW 2017 compliant'),
               ($1, CURRENT_DATE - INTERVAL '45 days', 7.5, 22.0, 'Negative for E. coli & Coliforms', 'pass', 'Metropolitan Water Quality Laboratory', 'DOH PNSDW 2017 compliant');
    """, b1_id)

    # 10. Permits
    print("Creating compliance permits...")
    await conn.execute("""
        INSERT INTO permits (branch_id, name, issuer, permit_number, expires_at, notes)
        VALUES ($1, 'Sanitary Permit to Operate', 'Pasig City Health Office', 'SAN-2026-00482', CURRENT_DATE + INTERVAL '180 days', 'Updated annual renewal'),
               ($1, 'DOH Certificate of Potability', 'Department of Health - NCR', 'DOH-POT-2026-991', CURRENT_DATE + INTERVAL '45 days', 'Requires routine quarterly renewal');
    """, b1_id)

    # 11. Sample Sales & Deliveries
    print("Creating sample sales...")
    s1_id = await conn.fetchval("""
        INSERT INTO sales (sale_number, branch_id, shift_id, customer_id, cashier_id, sale_type, payment_method, subtotal, discount, total, amount_paid, change_amount, containers_lent, containers_back, status)
        VALUES ('INV-20261007-1001', $1, $2, $3, $4, 'walk_in', 'cash', 60.0, 0.0, 60.0, 100.0, 40.0, 0, 0, 'completed')
        RETURNING id;
    """, b1_id, shift_id, c4_id, cashier_id)
    await conn.execute("INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, subtotal) VALUES ($1, $2, 'Purified Water Refill (5 Gal)', 2, 30.0, 60.0)", s1_id, p1_id)

    s2_id = await conn.fetchval("""
        INSERT INTO sales (sale_number, branch_id, shift_id, customer_id, cashier_id, sale_type, payment_method, subtotal, discount, total, amount_paid, change_amount, containers_lent, containers_back, status)
        VALUES ('INV-20261007-1002', $1, $2, $3, $4, 'delivery', 'gcash', 220.0, 0.0, 220.0, 220.0, 0.0, 5, 5, 'completed')
        RETURNING id;
    """, b1_id, shift_id, c1_id, cashier_id)
    await conn.execute("INSERT INTO sale_items (sale_id, product_id, product_name, qty, unit_price, subtotal) VALUES ($1, $2, 'Purified Water Refill (5 Gal)', 10, 22.0, 220.0)", s2_id, p1_id)

    # Deliveries
    await conn.execute("""
        INSERT INTO delivery_orders (branch_id, customer_id, sale_id, rider_id, status, delivery_address, barangay, gallons, amount, payment_method, is_paid)
        VALUES ($1, $2, $3, $4, 'out_for_delivery', '12 Brixton St.', 'Kapitolyo', 10, 220.0, 'gcash', TRUE),
               ($1, $5, NULL, NULL, 'pending', '45 West Capitol Drive', 'Kapitolyo', 3, 120.0, 'cash', FALSE);
    """, b1_id, c1_id, s2_id, rider_id, c3_id)

    # Expenses
    await conn.execute("""
        INSERT INTO expenses (branch_id, category, description, amount, payment_method, date, recorded_by, recorder_name)
        VALUES ($1, 'utilities', 'Meralco electricity bill (Sept-Oct cycle)', 4500.0, 'bank_transfer', CURRENT_DATE - INTERVAL '2 days', $2, 'Maria Santos'),
               ($1, 'supplies', 'Purified cap seals from AquaPro', 850.0, 'cash', CURRENT_DATE - INTERVAL '1 days', $2, 'Maria Santos');
    """, b1_id, owner_id)

    print("Seeding completed successfully!")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
