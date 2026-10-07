"""
config.py — Application settings loaded from .env
"""
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres@localhost:5432/wrsms_db"
)
# Normalize postgres:// to postgresql:// for asyncpg compatibility
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
JWT_SECRET: str = os.getenv("JWT_SECRET", "aquaflow-super-secret-jwt-key-2026-production-ready")
JWT_EXPIRY_HOURS: int = int(os.getenv("JWT_EXPIRY_HOURS", "8"))
UPLOADS_DIR: str = os.getenv("UPLOADS_DIR", "./uploads")

_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000"
)
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Ensure uploads directory exists
os.makedirs(UPLOADS_DIR, exist_ok=True)
