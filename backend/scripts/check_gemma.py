"""Verify the configured Gemma model works and list the Gemma models your key can use.

Usage (from backend/):  python scripts/check_gemma.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402


def main() -> int:
    settings = load_settings()
    if not settings.model_configured:
        print("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.")
        return 1
    from google import genai

    client = genai.Client(api_key=settings.gemini_api_key)
    print(f"Configured GEMMA_MODEL: {settings.gemma_model}")
    try:
        gemma = sorted(m.name for m in client.models.list() if "gemma" in (m.name or "").lower())
        print("Gemma models available to this key:")
        for name in gemma:
            print(f"  {name.replace('models/', '')}")
    except Exception as exc:
        print(f"Could not list models: {type(exc).__name__}: {exc}")
    try:
        reply = client.models.generate_content(model=settings.gemma_model, contents="Reply with: ready")
        print(f"OK - live call succeeded. Reply: {(reply.text or '').strip()[:80]!r}")
        return 0
    except Exception as exc:
        print(f"FAILED - {type(exc).__name__}: {exc}")
        print("Set GEMMA_MODEL in backend/.env to one of the models listed above.")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
