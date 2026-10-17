"""Runtime configuration, read from environment variables (and backend/.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DEFAULT_MODEL = "gemma-4-26b-a4b-it"
DEFAULT_THINKING_LEVEL = "MINIMAL"

# Input limits: keep untrusted content sent to the model bounded.
MAX_TASK_CHARS = 2_000
MAX_DOCUMENT_CHARS = 20_000
MAX_ARGUMENTS_JSON_CHARS = 4_000
MAX_REQUEST_BYTES = 64 * 1024


@dataclass(frozen=True)
class Settings:
    gemini_api_key: Optional[str]
    gemma_model: str
    model_timeout_seconds: float
    database_path: Path
    cors_origins: List[str] = field(default_factory=list)
    gemma_thinking_level: Optional[str] = DEFAULT_THINKING_LEVEL

    @property
    def model_configured(self) -> bool:
        return bool(self.gemini_api_key) and self.gemini_api_key != "your-api-key-here"


def load_settings() -> Settings:
    db_path = Path(os.getenv("DATABASE_PATH", "toolfence.db"))
    if not db_path.is_absolute():
        db_path = BACKEND_DIR / db_path
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
        gemma_model=os.getenv("GEMMA_MODEL") or DEFAULT_MODEL,
        model_timeout_seconds=float(os.getenv("MODEL_TIMEOUT_SECONDS", "20")),
        database_path=db_path,
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
        gemma_thinking_level=os.getenv("GEMMA_THINKING_LEVEL", DEFAULT_THINKING_LEVEL).strip().upper() or None,
    )
