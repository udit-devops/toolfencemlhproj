import os
import tempfile
from pathlib import Path
from typing import Optional

import pytest

# Never touch the developer's database or call a paid API from tests.
os.environ["DATABASE_PATH"] = str(Path(tempfile.mkdtemp()) / "import-time.db")
os.environ["GEMINI_API_KEY"] = ""

from app.analyzer import FixtureAnalyzer  # noqa: E402
from app.config import Settings  # noqa: E402
from app.gateway import Gateway  # noqa: E402
from app.schemas import AnalysisResult, ResolvedRequest, ThreatAssessment  # noqa: E402
from app.store import Store  # noqa: E402
from app.tools import build_registry  # noqa: E402


def assessment(severity="low", recommendation="allow", category="none") -> ThreatAssessment:
    return ThreatAssessment(risk_category=category, severity=severity, confidence=0.9,
                            recommendation=recommendation, task_alignment="aligned",
                            explanation="test", suspicious_excerpts=[])


class StaticAnalyzer:
    """Returns a preset AnalysisResult, or raises if given an exception."""

    def __init__(self, result: Optional[AnalysisResult] = None, raises: Optional[Exception] = None):
        self.result = result
        self.raises = raises
        self.calls = 0

    def analyze(self, req: ResolvedRequest) -> AnalysisResult:
        self.calls += 1
        if self.raises:
            raise self.raises
        return self.result


def permissive() -> FixtureAnalyzer:
    return FixtureAnalyzer(assessment("none", "allow"))


@pytest.fixture
def store(tmp_path) -> Store:
    return Store(tmp_path / "test.db")


@pytest.fixture
def registry():
    return build_registry()


@pytest.fixture
def make_gateway(store, registry):
    def _make(analyzer=None, reg=None):
        return Gateway(reg or registry, store, analyzer or permissive())
    return _make


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(gemini_api_key=None, gemma_model="gemma-test", model_timeout_seconds=1.0,
                    database_path=tmp_path / "api.db", cors_origins=[])
