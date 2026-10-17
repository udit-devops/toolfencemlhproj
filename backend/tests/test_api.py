"""HTTP API behaviour (model mocked via the fixture analyzer)."""
import dataclasses
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.analyzer import GemmaAnalyzer
from app.config import MAX_REQUEST_BYTES, load_settings
from app.main import create_app

from .conftest import permissive


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings, analyzer=permissive()))


def test_health_reports_unconfigured_model(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["database"] is True
    assert body["model"]["configured"] is False


def test_scenarios_listed(client):
    ids = [s["id"] for s in client.get("/api/scenarios").json()["scenarios"]]
    assert ids == ["safe_read", "indirect_injection", "unauthorized_destination", "model_disagreement"]


@pytest.mark.parametrize("scenario_id,decision,execution", [
    ("safe_read", "allow", "executed"),
    ("indirect_injection", "block", "not_executed"),
    ("unauthorized_destination", "block", "not_executed"),
    ("model_disagreement", "block", "not_executed"),
])
def test_run_scenarios(client, scenario_id, decision, execution):
    body = client.post("/api/simulations/run", json={"scenario_id": scenario_id}).json()
    assert body["policy"]["decision"] == decision
    assert body["execution"]["status"] == execution
    fetched = client.get(f"/api/audit/{body['event_id']}").json()
    assert fetched["event_id"] == body["event_id"]


def test_audit_filters_and_metrics(client):
    for sid in ["safe_read", "indirect_injection", "model_disagreement"]:
        client.post("/api/simulations/run", json={"scenario_id": sid})
    assert client.get("/api/audit", params={"decision": "block"}).json()["total"] == 2
    assert client.get("/api/audit", params={"scenario": "safe_read"}).json()["total"] == 1
    assert client.get("/api/audit", params={"q": "delete_customer_records"}).json()["total"] == 1
    m = client.get("/api/metrics").json()
    assert (m["total_requests"], m["allowed"], m["blocked"]) == (3, 1, 2)
    assert sum(p["allow"] + p["block"] for p in m["timeline"]["points"]) == 3


def test_validation_and_limits(client):
    assert client.post("/api/simulations/run", json={"scenario_id": "nope"}).status_code == 400
    assert client.post("/api/simulations/run", json={"task": "x"}).status_code == 400
    r = client.post("/api/simulations/run", json={"scenario_id": "safe_read", "document": "x" * 20_001})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = client.post("/api/simulations/run", json={"scenario_id": "safe_read", "fixture": "allow"})
    assert r.status_code == 422  # clients cannot inject model results
    assert client.get("/api/audit/evt_missing").status_code == 404


def test_policy_patch_rules(client):
    assert client.patch("/api/policies/tool_allowlist", json={"enabled": False}).status_code == 403
    assert client.patch("/api/policies/nope", json={"enabled": False}).status_code == 404
    r = client.patch("/api/policies/tool_allowlist", json={"config": {"allowed_tools": ["shell_exec"]}})
    assert r.status_code == 422
    r = client.patch("/api/policies/approved_destinations",
                     json={"config": {"allowed_domains": ["acme-corp.example", "acme-corp-mail.example"]}})
    assert r.status_code == 200
    body = client.post("/api/simulations/run", json={"scenario_id": "unauthorized_destination"}).json()
    assert body["policy"]["decision"] == "allow"  # policy change took effect server-side
    assert client.get("/api/policies").json()["changes"][0]["policy_id"] == "approved_destinations"


def test_thinking_level_setting(monkeypatch):
    monkeypatch.setenv("GEMMA_THINKING_LEVEL", "low")
    assert load_settings().gemma_thinking_level == "LOW"
    monkeypatch.setenv("GEMMA_THINKING_LEVEL", "")
    assert load_settings().gemma_thinking_level is None
    monkeypatch.delenv("GEMMA_THINKING_LEVEL")
    assert load_settings().gemma_thinking_level == "MINIMAL"


def test_health_model_probe_returns_only_reported_fields(settings):
    model_client = MagicMock()
    model_client.models.generate_content.return_value = MagicMock(text="ready")
    app = create_app(settings, analyzer=GemmaAnalyzer("test-key", "gemma-test", 1.0, client=model_client))
    probe = TestClient(app).get("/api/health", params={"check_model": True}).json()["model"]["last_probe"]
    assert probe["ok"] is True and probe["reply_excerpt"] == "ready"
    assert "error" not in probe


def test_error_responses_keep_envelope_and_cors_headers(settings, monkeypatch):
    origin = "http://localhost:5173"
    app = create_app(dataclasses.replace(settings, cors_origins=[origin]), analyzer=permissive())
    cors_client = TestClient(app)
    monkeypatch.setattr(app.state.gateway.store, "metrics", lambda: 1 / 0)
    r = cors_client.get("/api/metrics", headers={"Origin": origin})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    assert r.headers["access-control-allow-origin"] == origin
    r = cors_client.post("/api/simulations/run", content=b"x" * (MAX_REQUEST_BYTES + 1),
                         headers={"Origin": origin, "Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload_too_large"
    assert r.headers["access-control-allow-origin"] == origin


def test_audit_search_treats_wildcards_literally(client):
    client.post("/api/simulations/run", json={"scenario_id": "safe_read"})
    assert client.get("/api/audit", params={"q": "%"}).json()["total"] == 0
    assert client.get("/api/audit", params={"q": "get_customer_count"}).json()["total"] == 1


def test_policy_reset_restores_defaults_and_enforcement(client):
    client.patch("/api/policies/model_risk_gate", json={"enabled": False})
    client.patch("/api/policies/approved_destinations",
                 json={"config": {"allowed_domains": ["acme-corp.example", "acme-corp-mail.example"]}})
    run = {"scenario_id": "unauthorized_destination"}
    assert client.post("/api/simulations/run", json=run).json()["policy"]["decision"] == "allow"
    body = client.post("/api/policies/reset").json()
    by_id = {p["id"]: p for p in body["policies"]}
    assert by_id["model_risk_gate"]["enabled"] is True
    assert by_id["approved_destinations"]["config"] == {"allowed_domains": ["acme-corp.example"]}
    assert [c["policy_id"] for c in body["changes"][:2]] == ["model_risk_gate", "approved_destinations"]
    assert client.post("/api/simulations/run", json=run).json()["policy"]["decision"] == "block"
    assert client.post("/api/policies/reset").json()["changes"] == body["changes"]


def test_openapi_documents_typed_responses(client):
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert {"Health", "ScenarioList", "ToolList", "AuditPage", "PolicyList", "Metrics"} <= set(schemas)
