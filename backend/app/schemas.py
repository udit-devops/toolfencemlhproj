"""Pydantic models shared by the API, gateway, policy engine and audit store."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import MAX_ARGUMENTS_JSON_CHARS, MAX_DOCUMENT_CHARS, MAX_TASK_CHARS

Severity = Literal["none", "low", "medium", "high", "critical"]
SEVERITY_ORDER: Dict[str, int] = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

RiskCategory = Literal[
    "none",
    "prompt_injection",
    "data_exfiltration",
    "unauthorized_destination",
    "privilege_escalation",
    "destructive_action",
    "social_engineering",
    "other",
]
Recommendation = Literal["allow", "block", "review"]
Decision = Literal["allow", "block", "needs_approval"]


# --------------------------------------------------------------------------- requests


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:\-]+$")
    arguments: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("arguments")
    @classmethod
    def _bounded_arguments(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if len(json.dumps(value, default=str)) > MAX_ARGUMENTS_JSON_CHARS:
            raise ValueError(f"arguments exceed {MAX_ARGUMENTS_JSON_CHARS} characters when serialized")
        return value


class SimulationRequest(BaseModel):
    """A proposed agent action. Fields left empty are filled from the named scenario."""

    model_config = ConfigDict(extra="forbid")

    scenario_id: Optional[str] = Field(default=None, max_length=64)
    task: Optional[str] = Field(default=None, max_length=MAX_TASK_CHARS)
    document: Optional[str] = Field(default=None, max_length=MAX_DOCUMENT_CHARS)
    tool_call: Optional[ToolCall] = None
    human_approval: Optional[bool] = None


class ResolvedRequest(BaseModel):
    scenario_id: Optional[str]
    task: str
    document: str
    tool_call: ToolCall
    human_approval: bool


# --------------------------------------------------------------------------- threat analysis


class ThreatAssessment(BaseModel):
    """Structured output expected from Gemma. Treated as untrusted input."""

    model_config = ConfigDict(extra="ignore")

    risk_category: RiskCategory
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    recommendation: Recommendation
    task_alignment: Literal["aligned", "misaligned", "unclear"]
    explanation: str
    suspicious_excerpts: List[str] = Field(default_factory=list)

    @field_validator("risk_category", "severity", "recommendation", "task_alignment", mode="before")
    @classmethod
    def _normalize_enum(cls, value: Any) -> Any:
        return value.strip().lower().replace(" ", "_").replace("-", "_") if isinstance(value, str) else value

    @field_validator("explanation", mode="before")
    @classmethod
    def _truncate_explanation(cls, value: Any) -> Any:
        return value[:1500] if isinstance(value, str) else value

    @field_validator("suspicious_excerpts", mode="before")
    @classmethod
    def _truncate_excerpts(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return value
        return [str(v)[:400] for v in value[:8]]


AnalysisSource = Literal["live_model", "test_fixture", "none"]
AnalysisStatus = Literal["ok", "fixture", "error", "timeout", "invalid_response", "not_configured"]


class AnalysisResult(BaseModel):
    source: AnalysisSource
    status: AnalysisStatus
    model: Optional[str] = None
    latency_ms: Optional[int] = None
    assessment: Optional[ThreatAssessment] = None
    excerpts_verified: List[bool] = Field(default_factory=list)
    error: Optional[str] = None
    raw_response_excerpt: Optional[str] = None

    @property
    def usable(self) -> bool:
        return self.status in ("ok", "fixture") and self.assessment is not None


# --------------------------------------------------------------------------- policy


class PolicyRecord(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool
    locked: bool
    order: int
    config: Dict[str, Any]
    updated_at: str


class PolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None


CheckOutcome = Literal["pass", "fail", "approval_required", "not_applicable", "skipped", "disabled"]


class PolicyCheck(BaseModel):
    policy_id: str
    policy_name: str
    outcome: CheckOutcome
    detail: str


class PolicyDecision(BaseModel):
    decision: Decision
    matched_policy: Optional[str]
    reason: str
    checks: List[PolicyCheck]


# --------------------------------------------------------------------------- execution / audit


class ExecutionResult(BaseModel):
    status: Literal["executed", "not_executed", "failed"]
    output: Optional[Any] = None
    error: Optional[str] = None


class ModelVsPolicy(BaseModel):
    model_recommendation: Optional[Recommendation]
    policy_decision: Decision
    agreement: Optional[bool]


class AuditEvent(BaseModel):
    event_id: str
    created_at: str
    scenario_id: Optional[str]
    request: ResolvedRequest
    tool_sensitivity: Optional[str]
    analysis: AnalysisResult
    policy: PolicyDecision
    execution: ExecutionResult
    model_vs_policy: ModelVsPolicy
