"""Deterministic policy engine.

The engine never reads the model's ``recommendation`` to grant access. Model
output can only *tighten* a decision (the risk gate), and only when the model
analysis is usable. Every tool is denied unless it is registered, allowlisted
and its arguments validate.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Tuple
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .schemas import SEVERITY_ORDER, AnalysisResult, PolicyCheck, PolicyDecision, PolicyRecord, Severity, ToolCall
from .tools import ToolSpec

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


# --------------------------------------------------------------------------- config schemas


class EmptyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AllowlistConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allowed_tools: List[str] = Field(max_length=50)


class DestinationsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allowed_domains: List[str] = Field(max_length=50)

    @field_validator("allowed_domains")
    @classmethod
    def _valid_domains(cls, value: List[str]) -> List[str]:
        cleaned = []
        for d in value:
            d = d.strip().lower()
            if not DOMAIN_RE.match(d):
                raise ValueError(f"invalid domain: {d!r}")
            cleaned.append(d)
        return sorted(set(cleaned))


class ModelRequiredConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    exempt_read_only: bool = True


class RiskGateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    block_at_or_above: Severity = "high"
    applies_to: Literal["sensitive_only", "all_tools"] = "sensitive_only"
    honor_block_recommendation: bool = True


class ApprovalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    require_for: List[Literal["sensitive", "destructive"]] = Field(default_factory=lambda: ["sensitive", "destructive"])


CONFIG_MODELS: Dict[str, type] = {
    "deny_unknown_tools": EmptyConfig,
    "tool_allowlist": AllowlistConfig,
    "argument_validation": EmptyConfig,
    "approved_destinations": DestinationsConfig,
    "model_analysis_required": ModelRequiredConfig,
    "model_risk_gate": RiskGateConfig,
    "sensitive_action_approval": ApprovalConfig,
}


DEFAULT_POLICIES: List[Dict[str, Any]] = [
    {"id": "deny_unknown_tools", "name": "Deny unknown tools", "locked": True, "enabled": True,
     "description": "Tools that are not registered with the gateway are always rejected.", "config": {}},
    {"id": "tool_allowlist", "name": "Tool allowlist", "locked": True, "enabled": True,
     "description": "Only allowlisted tools may execute. Editable list; the policy itself cannot be disabled.",
     "config": {"allowed_tools": ["get_customer_count", "send_report"]}},
    {"id": "argument_validation", "name": "Argument schema validation", "locked": True, "enabled": True,
     "description": "Arguments must match the tool's strict schema (no extra fields, typed values).", "config": {}},
    {"id": "approved_destinations", "name": "Approved destinations", "locked": True, "enabled": True,
     "description": "Tools that send data may only target approved domains. Checked independently of the model.",
     "config": {"allowed_domains": ["acme-corp.example"]}},
    {"id": "model_analysis_required", "name": "Fail closed without analysis", "locked": True, "enabled": True,
     "description": "Non-read-only tools require a successful, schema-valid threat analysis. "
                    "Model errors, timeouts and malformed output block the action.",
     "config": {"exempt_read_only": True}},
    {"id": "model_risk_gate", "name": "Model risk gate", "locked": False, "enabled": True,
     "description": "Blocks when the analysis reports severity at or above the threshold. "
                    "The model can only tighten decisions, never grant access.",
     "config": {"block_at_or_above": "high", "applies_to": "sensitive_only", "honor_block_recommendation": True}},
    {"id": "sensitive_action_approval", "name": "Human approval for sensitive actions", "locked": False,
     "enabled": True,
     "description": "Sensitive and destructive tools need explicit human approval, which cannot come from the model "
                    "or the document.",
     "config": {"require_for": ["sensitive", "destructive"]}},
]
POLICY_ORDER = {p["id"]: i for i, p in enumerate(DEFAULT_POLICIES)}


class PolicyConfigError(ValueError):
    pass


def validate_policy_config(policy_id: str, config: Dict[str, Any], registry: Dict[str, ToolSpec]) -> Dict[str, Any]:
    model = CONFIG_MODELS.get(policy_id)
    if model is None:
        raise PolicyConfigError(f"unknown policy {policy_id!r}")
    try:
        parsed = model.model_validate(config)
    except ValidationError as exc:
        raise PolicyConfigError(exc.errors(include_url=False, include_context=False)) from exc
    if isinstance(parsed, AllowlistConfig):
        unknown = [t for t in parsed.allowed_tools if t not in registry]
        if unknown:
            raise PolicyConfigError(f"cannot allowlist unregistered tools: {unknown}")
        parsed.allowed_tools = sorted(set(parsed.allowed_tools))
    return parsed.model_dump()


# --------------------------------------------------------------------------- engine


def destination_domain(destination: str) -> Optional[str]:
    if "@" in destination and not destination.startswith("https://"):
        return destination.rsplit("@", 1)[1].lower()
    host = urlparse(destination).hostname
    return host.lower() if host else None


def domain_allowed(domain: str, allowed: List[str]) -> bool:
    return any(domain == d or domain.endswith("." + d) for d in allowed)


class PolicyEngine:
    def __init__(self, registry: Dict[str, ToolSpec]):
        self._registry = registry

    def evaluate(
        self,
        tool_call: ToolCall,
        analysis: AnalysisResult,
        policies: Dict[str, PolicyRecord],
        human_approval: bool,
    ) -> Tuple[PolicyDecision, Optional[BaseModel]]:
        """Return the decision and, if arguments validated, the parsed arguments."""
        checks: List[PolicyCheck] = []
        spec = self._registry.get(tool_call.name)
        validated: Optional[BaseModel] = None

        def add(pid: str, outcome: str, detail: str) -> None:
            checks.append(PolicyCheck(policy_id=pid, policy_name=self._name(policies, pid), outcome=outcome,
                                      detail=detail))

        def cfg(pid: str) -> Dict[str, Any]:
            # Missing or corrupt config falls back to the safe default, never to "allow".
            record = policies.get(pid)
            default = next(p["config"] for p in DEFAULT_POLICIES if p["id"] == pid)
            return record.config if record else default

        def enabled(pid: str) -> bool:
            record = policies.get(pid)
            return True if record is None or record.locked else record.enabled

        # 1. Deny unknown tools (always on).
        if spec is None:
            add("deny_unknown_tools", "fail", f"'{tool_call.name}' is not a registered tool.")
        else:
            add("deny_unknown_tools", "pass", f"'{spec.name}' is registered ({spec.sensitivity}).")

        # 2. Allowlist.
        allowed_tools = cfg("tool_allowlist").get("allowed_tools", [])
        if spec is None:
            add("tool_allowlist", "skipped", "Tool is unknown.")
        elif spec.name in allowed_tools:
            add("tool_allowlist", "pass", f"'{spec.name}' is allowlisted.")
        else:
            add("tool_allowlist", "fail", f"'{spec.name}' is not on the allowlist.")

        # 3. Argument validation.
        if spec is None:
            add("argument_validation", "skipped", "Tool is unknown.")
        else:
            try:
                validated = spec.args_model.model_validate(tool_call.arguments)
                add("argument_validation", "pass", "Arguments match the tool schema.")
            except ValidationError as exc:
                problems = "; ".join(f"{'.'.join(str(p) for p in e['loc']) or 'arguments'}: {e['msg']}"
                                     for e in exc.errors(include_url=False))
                add("argument_validation", "fail", f"Invalid arguments: {problems}")

        # 4. Approved destinations (independent of the model).
        if spec is None or spec.destination_field is None:
            add("approved_destinations", "not_applicable", "Tool does not send data to a destination.")
        elif validated is None:
            add("approved_destinations", "skipped", "Arguments did not validate.")
        else:
            dest = str(getattr(validated, spec.destination_field))
            domain = destination_domain(dest)
            allowed_domains = cfg("approved_destinations").get("allowed_domains", [])
            if domain and domain_allowed(domain, allowed_domains):
                add("approved_destinations", "pass", f"Destination domain '{domain}' is approved.")
            else:
                add("approved_destinations", "fail",
                    f"Destination '{dest}' (domain '{domain}') is not in the approved list {allowed_domains}.")

        # 5. Fail closed when analysis is unavailable.
        exempt_read_only = cfg("model_analysis_required").get("exempt_read_only", True)
        if spec is not None and spec.sensitivity == "read_only" and exempt_read_only:
            add("model_analysis_required", "not_applicable",
                f"Read-only tool; may proceed without analysis (analysis status: {analysis.status}).")
        elif analysis.usable:
            add("model_analysis_required", "pass", f"Analysis available ({analysis.source}).")
        else:
            add("model_analysis_required", "fail",
                f"Analysis unavailable (status: {analysis.status}); protected action fails closed.")

        # 6. Model risk gate (can only tighten).
        gate = cfg("model_risk_gate")
        if not enabled("model_risk_gate"):
            add("model_risk_gate", "disabled", "Policy disabled.")
        elif not analysis.usable:
            add("model_risk_gate", "skipped", "No usable analysis to evaluate.")
        elif spec is not None and spec.sensitivity == "read_only" and gate.get("applies_to") == "sensitive_only":
            add("model_risk_gate", "not_applicable", "Gate applies to sensitive tools only.")
        else:
            a = analysis.assessment
            threshold = gate.get("block_at_or_above", "high")
            if SEVERITY_ORDER[a.severity] >= SEVERITY_ORDER[threshold]:
                add("model_risk_gate", "fail", f"Reported severity '{a.severity}' meets threshold '{threshold}'.")
            elif gate.get("honor_block_recommendation", True) and a.recommendation == "block":
                add("model_risk_gate", "fail", "Analysis recommended blocking.")
            else:
                add("model_risk_gate", "pass", f"Reported severity '{a.severity}' is below threshold '{threshold}'.")

        # 7. Human approval.
        require_for = cfg("sensitive_action_approval").get("require_for", [])
        if not enabled("sensitive_action_approval"):
            add("sensitive_action_approval", "disabled", "Policy disabled.")
        elif spec is None or spec.sensitivity not in require_for:
            add("sensitive_action_approval", "not_applicable", "Tool does not require approval.")
        elif human_approval:
            add("sensitive_action_approval", "pass", "Explicit human approval supplied.")
        else:
            add("sensitive_action_approval", "approval_required",
                f"'{spec.name}' is {spec.sensitivity}; explicit human approval is required.")

        failed = [c for c in checks if c.outcome == "fail"]
        pending = [c for c in checks if c.outcome == "approval_required"]
        if failed:
            first = failed[0]
            decision = PolicyDecision(decision="block", matched_policy=first.policy_id,
                                      reason=first.detail, checks=checks)
        elif pending:
            decision = PolicyDecision(decision="needs_approval", matched_policy=pending[0].policy_id,
                                      reason=pending[0].detail, checks=checks)
        elif spec is None or validated is None:  # defensive: never allow without a spec and valid args
            decision = PolicyDecision(decision="block", matched_policy="deny_unknown_tools",
                                      reason="Deny by default.", checks=checks)
        else:
            decision = PolicyDecision(decision="allow", matched_policy=None,
                                      reason="All applicable policies passed.", checks=checks)
        return decision, (validated if decision.decision == "allow" else None)

    @staticmethod
    def _name(policies: Dict[str, PolicyRecord], pid: str) -> str:
        if pid in policies:
            return policies[pid].name
        return next((p["name"] for p in DEFAULT_POLICIES if p["id"] == pid), pid)
