"""
database.py — Async PostgreSQL connection pool using asyncpg.
Provides high-performance connection pooling and query helpers.
"""
import asyncpg
from decimal import Decimal
from datetime import datetime, date
from typing import Any, Optional, List, Dict
import os
from config import DATABASE_URL

_pool: Optional[asyncpg.Pool] = None


def to_dict(record: Optional[asyncpg.Record]) -> Optional[Dict[str, Any]]:
    """Converts an asyncpg Record to a JSON-serializable Python dictionary."""
    if record is None:
        return None
    d = {}
    for k, v in record.items():
        if isinstance(v, Decimal):
            d[k] = float(v)
        elif isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


def to_dicts(records: List[asyncpg.Record]) -> List[Dict[str, Any]]:
    """Converts a list of asyncpg Records to a list of dicts."""
    return [to_dict(r) for r in records if r is not None]


async def connect_db() -> None:
    """Initialize the PostgreSQL connection pool and apply schema if needed."""
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=2,
        max_size=10,
        command_timeout=60,
    )

    # Automatically ensure schema tables exist
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    if os.path.exists(schema_path):
        async with _pool.acquire() as conn:
            with open(schema_path, "r", encoding="utf-8") as f:
                schema_sql = f.read()
            await conn.execute(schema_sql)


async def close_db() -> None:
    """Close the PostgreSQL connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    """Returns active connection pool."""
    if _pool is None:
        raise RuntimeError("Database not connected. Call connect_db() first.")
    return _pool


class Database:
    """Wrapper class providing convenient helper methods for query execution."""

    @staticmethod
    async def fetch_one(query: str, *args) -> Optional[Dict[str, Any]]:
        pool = get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, *args)
            return to_dict(row)

    @staticmethod
    async def fetch_all(query: str, *args) -> List[Dict[str, Any]]:
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *args)
            return to_dicts(rows)

    @staticmethod
    async def fetch_val(query: str, *args) -> Any:
        pool = get_pool()
        async with pool.acquire() as conn:
            val = await conn.fetchval(query, *args)
            if isinstance(val, Decimal):
                return float(val)
            return val

    @staticmethod
    async def execute(query: str, *args) -> str:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.execute(query, *args)

    @staticmethod
    async def resolve_branch(bid: Optional[str], current_user: Optional[dict] = None) -> Optional[str]:
        if not bid and current_user:
            return current_user.get("branch_id")
        if not bid:
            return None
        pool = get_pool()
        async with pool.acquire() as conn:
            found = await conn.fetchval("SELECT id FROM branches WHERE id = $1", str(bid))
            if found:
                return found
            found = await conn.fetchval(
                "SELECT id FROM branches WHERE name ILIKE $1 OR city ILIKE $1 OR barangay ILIKE $1 LIMIT 1",
                f"%{bid}%"
            )
            if found:
                return found
            if current_user and current_user.get("branch_id"):
                return current_user["branch_id"]
            first = await conn.fetchval("SELECT id FROM branches WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1")
            return first if first else str(bid)


def get_db() -> Database:
    """FastAPI dependency for accessing PostgreSQL."""
    return Database
