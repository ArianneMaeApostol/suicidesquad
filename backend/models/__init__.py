"""
models/ — Shared Pydantic v2 schemas and data validation helpers.
"""
from pydantic import BaseModel, Field
from typing import Any, Optional, Dict, List


class BaseSchema(BaseModel):
    """Base Pydantic model with convenient configuration."""
    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }
