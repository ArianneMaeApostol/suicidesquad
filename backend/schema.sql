-- ============================================================================
-- schema.sql — PostgreSQL Schema for AquaFlow WRSMS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Branches
CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    barangay VARCHAR(100),
    city VARCHAR(100) DEFAULT 'Pasig City',
    province VARCHAR(100) DEFAULT 'Metro Manila',
    phone VARCHAR(50),
    tin VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users (Operator accounts for all 4 roles)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- 'owner', 'manager', 'cashier', 'rider'
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Customers
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    barangay VARCHAR(100),
    type VARCHAR(50) DEFAULT 'walk_in', -- 'walk_in', 'regular', 'reseller', 'commercial'
    balance NUMERIC(12,2) DEFAULT 0.00,
    credit_limit NUMERIC(12,2) DEFAULT 0.00,
    containers_out INT DEFAULT 0,
    slim_borrowed INT DEFAULT 0,
    round_borrowed INT DEFAULT 0,
    dispenser_borrowed INT DEFAULT 0,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Shifts (POS cash register shifts)
CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    opening_cash NUMERIC(12,2) DEFAULT 0.00,
    closing_cash NUMERIC(12,2),
    expected_cash NUMERIC(12,2),
    cash_variance NUMERIC(12,2),
    notes TEXT
);

-- 5. Products
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'refill',
    unit VARCHAR(50) DEFAULT 'gallon',
    is_container BOOLEAN DEFAULT FALSE,
    container_type VARCHAR(50) DEFAULT 'none',
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Product Prices (Tier pricing per customer type)
CREATE TABLE IF NOT EXISTS product_prices (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
    customer_type VARCHAR(50) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    UNIQUE(product_id, customer_type)
);

-- 7. Sales
CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    sale_number VARCHAR(100),
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    shift_id TEXT REFERENCES shifts(id) ON DELETE SET NULL,
    customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
    cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    sale_type VARCHAR(50) DEFAULT 'walk_in', -- 'walk_in', 'delivery'
    payment_method VARCHAR(50) DEFAULT 'cash', -- 'cash', 'gcash', 'maya', 'credit', 'prepaid'
    subtotal NUMERIC(12,2) DEFAULT 0.00,
    discount NUMERIC(12,2) DEFAULT 0.00,
    total NUMERIC(12,2) DEFAULT 0.00,
    amount_paid NUMERIC(12,2) DEFAULT 0.00,
    change_amount NUMERIC(12,2) DEFAULT 0.00,
    containers_lent INT DEFAULT 0,
    containers_back INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'completed',
    is_voided BOOLEAN DEFAULT FALSE,
    void_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    qty INT NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    subtotal NUMERIC(12,2) NOT NULL,
    gallons_lent INT DEFAULT 0,
    gallons_returned INT DEFAULT 0
);

-- 9. Payments (Customer balance/credit repayments)
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
    customer_name VARCHAR(255),
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    cashier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    cashier_name VARCHAR(255),
    amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'cash',
    reference_no VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Delivery Orders
CREATE TABLE IF NOT EXISTS delivery_orders (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
    rider_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'assigned', 'out_for_delivery', 'delivered', 'cancelled'
    delivery_address TEXT,
    barangay VARCHAR(100),
    gallons INT DEFAULT 0,
    slim_count INT DEFAULT 0,
    round_count INT DEFAULT 0,
    amount NUMERIC(12,2) DEFAULT 0.00,
    payment_method VARCHAR(50) DEFAULT 'cash',
    is_paid BOOLEAN DEFAULT FALSE,
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    contact VARCHAR(100),
    phone VARCHAR(50),
    address TEXT,
    supplies_provided TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Inventory Items
CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'container',
    unit VARCHAR(50) DEFAULT 'pcs',
    quantity NUMERIC(12,2) DEFAULT 0.00,
    reorder_point NUMERIC(12,2) DEFAULT 10.00,
    cost_per_unit NUMERIC(10,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Inventory Movements
CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES inventory_items(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'in', 'out', 'adjustment'
    qty NUMERIC(12,2) NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Equipment
CREATE TABLE IF NOT EXISTS equipment (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    model VARCHAR(100),
    serial_no VARCHAR(100),
    status VARCHAR(50) DEFAULT 'operational', -- 'operational', 'needs_maintenance', 'under_repair', 'offline'
    installed_at DATE,
    last_serviced DATE,
    next_service DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Maintenance Tasks
CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    equipment_id TEXT REFERENCES equipment(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    task_type VARCHAR(100) DEFAULT 'filter_change',
    due_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'completed', 'overdue'
    completed_at TIMESTAMPTZ,
    technician_name VARCHAR(100),
    cost NUMERIC(10,2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Water Tests (DOH)
CREATE TABLE IF NOT EXISTS water_tests (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    sample_date DATE DEFAULT CURRENT_DATE,
    ph NUMERIC(5,2),
    tds NUMERIC(8,2),
    bacteria_result VARCHAR(100) DEFAULT 'Negative',
    result VARCHAR(50) DEFAULT 'pass', -- 'pass', 'fail', 'pending'
    certificate_path TEXT,
    laboratory VARCHAR(255) DEFAULT 'DOH Accredited Water Testing Lab',
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. Permits
CREATE TABLE IF NOT EXISTS permits (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    issuer VARCHAR(255) DEFAULT 'DOH / LGU',
    permit_number VARCHAR(100),
    issued_at DATE,
    expires_at DATE NOT NULL,
    file_path TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. Expenses
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'cash',
    reference_no VARCHAR(100),
    date DATE DEFAULT CURRENT_DATE,
    recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    recorder_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. Customer Container Ledger
CREATE TABLE IF NOT EXISTS container_ledger (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
    container_type VARCHAR(50) DEFAULT 'slim',
    quantity_change INT NOT NULL,
    balance_after INT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_customers_branch ON customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_closed ON shifts(branch_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_delivery_branch_status ON delivery_orders(branch_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_branch ON inventory_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_maintenance_branch_due ON maintenance_tasks(branch_id, due_date);
CREATE INDEX IF NOT EXISTS idx_permits_branch_expires ON permits(branch_id, expires_at);
