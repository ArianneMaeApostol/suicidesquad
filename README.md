# AquaFlow WRSMS — Water Refilling Station Management System

Engineered for Philippine water refilling stations (Pasig City & Cainta branches). Full POS, container loan ledger (Slim & Round 5-gallon), dispatch Kanban board, DOH quality testing compliance, and multi-branch management.

---

## 🛠 Tech Stack

- **Database**: PostgreSQL (Active on `postgresql://postgres@localhost:5432/wrsms_db`)
- **Backend**: Python FastAPI with `asyncpg` high-performance connection pooling
- **Frontend**: Vanilla HTML5, CSS3, ES Modules with Role-Based Access Control (RBAC)

---

## 🚀 How to Run the Project

### 1. Database Setup (PostgreSQL)

The database schema and demo records are already created. If you ever need to reset and re-seed:

```bash
# Seed demo data (Branches, Users, Products, Shifts, Customers, Inventory)
backend/venv/bin/python backend/seed.py
```

### 2. Start the FastAPI Backend Server

```bash
cd backend
./venv/bin/uvicorn main:app --reload --port 8000
```
- API Health Check: [http://localhost:8000/api/health](http://localhost:8000/api/health)
- Interactive Swagger API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### 3. Start the Frontend Web Server

From the project root directory, serve the static frontend:

```bash
python3 -m http.server 5500
# or: npx serve -l 5500 .
```

Open your browser at:
👉 **[http://localhost:5500/login.html](http://localhost:5500/login.html)**

---

## 🔑 Demo Login Credentials

All demo accounts use password: **`password123`**

| Role | Email | Scope |
| :--- | :--- | :--- |
| **Station Owner** | `maria.santos@aquaflow.ph` | Full system access + multi-branch switcher |
| **Station Manager** | `juan.delacruz@aquaflow.ph` | Operations, inventory, maintenance & reports |
| **Head Cashier** | `head.cashier@aquaflow.ph` | POS counter, customer credit & shift register |
| **Delivery Rider** | `rider.pasig@aquaflow.ph` | Delivery Kanban & dispatch status updater |
