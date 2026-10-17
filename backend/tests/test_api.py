"""HTTP API behaviour (model mocked via the fixture analyzer)."""
import pytest
from fastapi.testclient import TestClient

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
