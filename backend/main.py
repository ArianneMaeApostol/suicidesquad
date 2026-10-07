"""
main.py — AquaFlow Water Refilling Station Management System API.
FastAPI entrypoint with async lifespan, CORS, uploaded file serving, and routers.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from config import ALLOWED_ORIGINS, UPLOADS_DIR
from database import connect_db, close_db
from routers import (
    auth,
    branches,
    customers,
    products,
    shifts,
    sales,
    payments,
    deliveries,
    inventory,
    maintenance,
    expenses,
    reports,
    users,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_db()
    yield
    # Shutdown
    await close_db()


app = FastAPI(
    title="AquaFlow WRSMS API",
    description="Backend API for Water Refilling Station Management System in the Philippines",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits all local and hosted frontends
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for uploads (compliance certs, permits)
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Include feature routers
app.include_router(auth.router)
app.include_router(branches.router)
app.include_router(customers.router)
app.include_router(products.router)
app.include_router(shifts.router)
app.include_router(sales.router)
app.include_router(payments.router)
app.include_router(deliveries.router)
app.include_router(inventory.router)
app.include_router(maintenance.router)
app.include_router(expenses.router)
app.include_router(reports.router)
app.include_router(users.router)


@app.get("/api/health", tags=["system"])
async def health():
    return {"status": "ok", "system": "AquaFlow WRSMS API"}
