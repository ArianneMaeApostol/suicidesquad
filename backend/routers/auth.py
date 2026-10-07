"""
routers/auth.py — Login, logout, and current-user endpoints using PostgreSQL.
POST /api/auth/login
GET  /api/auth/me
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt

from config import JWT_SECRET, JWT_EXPIRY_HOURS
from database import get_db, Database
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


def _make_token(user: dict) -> str:
    payload = {
        "sub": str(user["id"]),
        "role": user["role"],
        "branch_id": user.get("branch_id"),
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def _safe_user(user: dict) -> dict:
    """Return user dict without password hash."""
    return {k: v for k, v in user.items() if k != "password_hash"}


@router.post("/login")
async def login(body: LoginRequest, db: Database = Depends(get_db)):
    email_clean = body.email.strip().lower()
    user = await db.fetch_one("SELECT * FROM users WHERE LOWER(email) = $1", email_clean)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    stored_hash = user["password_hash"]
    if isinstance(stored_hash, str):
        stored_hash = stored_hash.encode("utf-8")

    if not bcrypt.checkpw(body.password.encode("utf-8"), stored_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Contact the station owner."
        )

    token = _make_token(user)
    return {"token": token, "user": _safe_user(user)}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return _safe_user(current_user)
