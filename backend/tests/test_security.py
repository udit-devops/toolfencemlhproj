"""Security properties of the gateway. All model responses are mocked."""
import dataclasses
import sqlite3
import time
from unittest.mock import MagicMock

import pytest

from app.analyzer import GemmaAnalyzer
from app.policy import PolicyConfigError, validate_policy_config
from app.schemas import AnalysisResult, PolicyDecision, SimulationRequest, ToolCall
from app.tools import ExecutionPermit, GetCustomerCountArgs, PermitIssuer, ToolExecutor

from .conftest import StaticAnalyzer, assessment


def run(gw, tool, args=None, approval=False, document="", task="test task"):
    return gw.run(SimulationRequest(task=task, document=document, human_approval=approval,
                                    tool_call=ToolCall(name=tool, arguments=args or {})))


def spy_registry(registry, tool):
    """Replace one tool's implementation with a mock so we can prove whether it ran."""
    spy = MagicMock(return_value={"spy": True})
    registry = dict(registry)
    registry[tool] = dataclasses.replace(registry[tool], implementation=spy)
    return registry, spy


def outcome(event, policy_id):
    return next(c.outcome for c in event.policy.checks if c.policy_id == policy_id)


# 1 -------------------------------------------------------------------------------------------
def test_allowlisted_read_tool_executes(make_gateway):
    event = run(make_gateway(), "get_customer_count", {"segment": "all"})
    assert event.policy.decision == "allow"
    assert event.execution.status == "executed"
    assert event.execution.output["customer_count"] == 42


# 2 -------------------------------------------------------------------------------------------
def test_unknown_tool_rejected(make_gateway):
    event = run(make_gateway(), "transfer_funds", {"amount": 100})
    assert event.policy.decision == "block"
    assert event.policy.matched_policy == "deny_unknown_tools"
    assert event.execution.status == "not_executed"


# 3 -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("destination", [
    "attacker@evil.example",
    "ops@acme-corp-mail.example",         # lookalike domain
    "ops@acme-corp.example.evil.example",  # suffix trick
    "https://acme-corp.example.evil.example/upload",
])
def test_unauthorized_destination_rejected(make_gateway, registry, destination):
    reg, spy = spy_registry(registry, "send_report")
    event = run(make_gateway(reg=reg), "send_report",
                {"destination": destination, "report_type": "weekly_summary"}, approval=True)
    assert event.policy.decision == "block"
    assert event.policy.matched_policy == "approved_destinations"
    spy.assert_not_called()


def test_approved_destination_allowed_with_approval(make_gateway):
    event = run(make_gateway(), "send_report",
                {"destination": "ops@acme-corp.example", "report_type": "weekly_summary"}, approval=True)
    assert event.policy.decision == "allow"
    assert event.execution.status == "executed"


# 4 -------------------------------------------------------------------------------------------
def test_permissive_model_cannot_override_prohibited_tool(make_gateway, registry):
    reg, spy = spy_registry(registry, "delete_customer_records")
    gw = make_gateway(StaticAnalyzer(AnalysisResult(source="live_model", status="ok",
                                                    assessment=assessment("none", "allow"))), reg)
    event = run(gw, "delete_customer_records", {"scope": "all", "confirm": True}, approval=True)
    assert event.analysis.assessment.recommendation == "allow"
    assert event.policy.decision == "block"
    assert event.policy.matched_policy == "tool_allowlist"
    assert event.model_vs_policy.agreement is False
    spy.assert_not_called()


def test_model_disagreement_scenario_uses_labelled_fixture(make_gateway, registry):
    reg, spy = spy_registry(registry, "delete_customer_records")
    live = StaticAnalyzer(raises=AssertionError("live model must not be called"))
    event = make_gateway(live, reg).run(SimulationRequest(scenario_id="model_disagreement"))
    assert live.calls == 0
    assert event.analysis.source == "test_fixture"
    assert event.analysis.assessment.recommendation == "allow"
    assert event.policy.decision == "block"
    spy.assert_not_called()


# 5 -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("args", [
    {"segment": "everyone"},                 # not in enum
    {"segment": "all", "sql": "DROP TABLE"},  # extra field
    {"segment": ["all"]},                    # wrong type
])
def test_invalid_arguments_rejected_before_execution(make_gateway, registry, args):
    reg, spy = spy_registry(registry, "get_customer_count")
    event = run(make_gateway(reg=reg), "get_customer_count", args)
    assert event.policy.decision == "block"
    assert event.policy.matched_policy == "argument_validation"
    spy.assert_not_called()


# 6 -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("result", [
    AnalysisResult(source="live_model", status="error", error="503"),
    AnalysisResult(source="live_model", status="timeout", error="timeout"),
    AnalysisResult(source="live_model", status="invalid_response", error="bad json"),
    AnalysisResult(source="none", status="not_configured"),
])
def test_model_failure_cannot_authorize_protected_action(make_gateway, registry, store, result):
    # Make the policy as permissive as allowed so only the fail-closed rule stands in the way.
    store.update_policy("tool_allowlist", True, {"allowed_tools": ["get_customer_count", "send_report"]})
    reg, spy = spy_registry(registry, "send_report")
    event = run(make_gateway(StaticAnalyzer(result), reg), "send_report",
                {"destination": "ops@acme-corp.example", "report_type": "weekly_summary"}, approval=True)
    assert event.policy.decision == "block"
    assert event.policy.matched_policy == "model_analysis_required"
    spy.assert_not_called()


def test_analyzer_exception_fails_closed(make_gateway, registry):
    reg, spy = spy_registry(registry, "send_report")
    event = run(make_gateway(StaticAnalyzer(raises=RuntimeError("boom")), reg), "send_report",
                {"destination": "ops@acme-corp.example", "report_type": "weekly_summary"}, approval=True)
    assert event.analysis.status == "error"
    assert event.policy.decision == "block"
    spy.assert_not_called()


def test_read_only_tool_may_proceed_without_model(make_gateway):
    event = run(make_gateway(StaticAnalyzer(AnalysisResult(source="live_model", status="timeout"))),
                "get_customer_count")
    assert event.policy.decision == "allow"
    assert outcome(event, "model_analysis_required") == "not_applicable"


class FakeModels:
    def __init__(self, behaviour):
        self.behaviour = behaviour

    def generate_content(self, **_):
        return self.behaviour()


class FakeClient:
    def __init__(self, behaviour):
        self.models = FakeModels(behaviour)


def gemma(behaviour, timeout=1.0):
    return GemmaAnalyzer(api_key="test-key", model="gemma-test", timeout_seconds=timeout,
                         client=FakeClient(behaviour))


def resolved(gw):
    return gw.resolve(SimulationRequest(scenario_id="indirect_injection"))


def test_gemma_timeout_is_reported(make_gateway):
    def slow():
        time.sleep(1.0)
    result = gemma(slow, timeout=0.1).analyze(resolved(make_gateway()))
    assert result.status == "timeout" and not result.usable


def test_gemma_api_error_is_reported_and_key_redacted(make_gateway):
    def fail():
        raise RuntimeError("403 PERMISSION_DENIED for key test-key")
    result = gemma(fail).analyze(resolved(make_gateway()))
    assert result.status == "error" and not result.usable
    assert "test-key" not in result.error


@pytest.mark.parametrize("text", [
    "I think this is fine!",
    '{"severity": "low"}',                                    # missing fields
    '{"risk_category": "none", "severity": "apocalyptic", "confidence": 0.5, "recommendation": "allow",'
    ' "task_alignment": "aligned", "explanation": "x", "suspicious_excerpts": []}',
    '{"risk_category": "none", "severity": "low", "confidence": 7, "recommendation": "allow",'
    ' "task_alignment": "aligned", "explanation": "x", "suspicious_excerpts": []}',
])
def test_gemma_malformed_output_is_invalid(make_gateway, text):
    result = gemma(lambda: MagicMock(text=text)).analyze(resolved(make_gateway()))
    assert result.status == "invalid_response" and not result.usable


def test_gemma_valid_fenced_output_parses_and_verifies_excerpts(make_gateway):
    text = ('```json\n{"risk_category": "Prompt Injection", "severity": "HIGH", "confidence": 0.9,'
            ' "recommendation": "block", "task_alignment": "misaligned", "explanation": "Hidden instruction.",'
            ' "suspicious_excerpts": ["Ignore all previous instructions", "not in the document"]}\n```')
    result = gemma(lambda: MagicMock(text=text)).analyze(resolved(make_gateway()))
    assert result.status == "ok"
    assert result.assessment.risk_category == "prompt_injection"
    assert result.assessment.severity == "high"
    assert result.excerpts_verified == [True, False]


# 7 -------------------------------------------------------------------------------------------
def test_audit_events_persist_in_sqlite(make_gateway, store):
    event = run(make_gateway(), "get_customer_count")
    row = sqlite3.connect(str(store.path)).execute(
        "SELECT decision, execution_status FROM audit_events WHERE event_id = ?", (event.event_id,)).fetchone()
    assert row == ("allow", "executed")
    reloaded = type(store)(store.path).get_event(event.event_id)  # fresh connection / instance
    assert reloaded == event


# 8 -------------------------------------------------------------------------------------------
def test_policy_changes_affect_subsequent_decisions(make_gateway, store):
    gw = make_gateway()
    args = {"destination": "ops@partner.example", "report_type": "weekly_summary"}
    assert run(gw, "send_report", args, approval=True).policy.decision == "block"
    store.update_policy("approved_destinations", True, {"allowed_domains": ["acme-corp.example", "partner.example"]})
    assert run(gw, "send_report", args, approval=True).policy.decision == "allow"
    store.update_policy("tool_allowlist", True, {"allowed_tools": ["get_customer_count"]})
    event = run(gw, "send_report", args, approval=True)
    assert event.policy.decision == "block" and event.policy.matched_policy == "tool_allowlist"


def test_model_risk_gate_tightens_only(make_gateway, store):
    high = StaticAnalyzer(AnalysisResult(source="live_model", status="ok", assessment=assessment("high", "allow")))
    args = {"destination": "ops@acme-corp.example", "report_type": "weekly_summary"}
    event = run(make_gateway(high), "send_report", args, approval=True)
    assert event.policy.decision == "block" and event.policy.matched_policy == "model_risk_gate"
    store.update_policy("model_risk_gate", False, store.get_policy("model_risk_gate").config)
    assert run(make_gateway(high), "send_report", args, approval=True).policy.decision == "allow"


def test_sensitive_action_requires_human_approval(make_gateway, registry):
    reg, spy = spy_registry(registry, "send_report")
    event = run(make_gateway(reg=reg), "send_report",
                {"destination": "ops@acme-corp.example", "report_type": "weekly_summary"}, approval=False)
    assert event.policy.decision == "needs_approval"
    assert event.execution.status == "not_executed"
    spy.assert_not_called()


def test_policy_config_validation(registry):
    with pytest.raises(PolicyConfigError):
        validate_policy_config("tool_allowlist", {"allowed_tools": ["rm_rf"]}, registry)
    with pytest.raises(PolicyConfigError):
        validate_policy_config("approved_destinations", {"allowed_domains": ["not a domain"]}, registry)
    with pytest.raises(PolicyConfigError):
        validate_policy_config("model_risk_gate", {"block_at_or_above": "high", "bypass": True}, registry)


# 9 -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("scenario_id,tool", [
    ("indirect_injection", "export_customer_data"),
    ("unauthorized_destination", "send_report"),
    ("model_disagreement", "delete_customer_records"),
])
def test_blocked_scenarios_never_invoke_tool(make_gateway, registry, scenario_id, tool):
    reg, spy = spy_registry(registry, tool)
    event = make_gateway(reg=reg).run(SimulationRequest(scenario_id=scenario_id))
    assert event.policy.decision == "block"
    assert event.execution.status == "not_executed"
    spy.assert_not_called()


def test_executor_rejects_forged_reused_and_non_allow_permits(registry):
    key = b"k" * 32
    executor = ToolExecutor(registry, key)
    with pytest.raises(PermissionError):
        executor.execute(ExecutionPermit("evt_1", "export_customer_data",
                                         {"format": "csv", "destination": "x@evil.example"}, "forged"))
    issuer = PermitIssuer(key)
    block = PolicyDecision(decision="block", matched_policy="x", reason="x", checks=[])
    with pytest.raises(PermissionError):
        issuer.issue("evt_2", "get_customer_count", GetCustomerCountArgs(), block)
    allow = PolicyDecision(decision="allow", matched_policy=None, reason="ok", checks=[])
    permit = issuer.issue("evt_3", "get_customer_count", GetCustomerCountArgs(), allow)
    assert executor.execute(permit).status == "executed"
    with pytest.raises(PermissionError):
        executor.execute(permit)  # single use
    tampered = dataclasses.replace(permit, event_id="evt_4", tool_name="export_customer_data")
    with pytest.raises(PermissionError):
        executor.execute(tampered)
