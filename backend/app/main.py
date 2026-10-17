"""FastAPI application exposing the ToolFence gateway."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .analyzer import Analyzer, GemmaAnalyzer
from .config import MAX_DOCUMENT_CHARS, MAX_REQUEST_BYTES, MAX_TASK_CHARS, Settings, load_settings
from .gateway import Gateway, RequestError
from .policy import PolicyConfigError, validate_policy_config
from .scenarios import SCENARIOS
from .schemas import (AuditEvent, AuditPage, Health, Limits, Metrics, ModelInfo, ModelProbe, PolicyList, PolicyRecord,
                      PolicyUpdate, ScenarioList, SimulationRequest, ToolList)
from .store import Store
from .tools import build_registry

logger = logging.getLogger("toolfence")


def _error(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


def create_app(settings: Optional[Settings] = None, analyzer: Optional[Analyzer] = None) -> FastAPI:
    settings = settings or load_settings()
    registry = build_registry()
    store = Store(settings.database_path)
    analyzer = analyzer or GemmaAnalyzer(settings.gemini_api_key if settings.model_configured else None,
                                         settings.gemma_model, settings.model_timeout_seconds,
                                         thinking_level=settings.gemma_thinking_level)
    gateway = Gateway(registry, store, analyzer)
    probe_cache: Dict[str, ModelProbe] = {}

    app = FastAPI(title="ToolFence", version="1.0.0",
                  description="Runtime security gateway for AI agent tool calls.")
    app.state.gateway = gateway

    # Registered before CORS so CORS wraps it: 413 and 500 responses then carry CORS headers
    # and the browser shows the real error instead of a generic network failure.
    @app.middleware("http")
    async def guard_requests(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
            return _error(413, "payload_too_large", f"Request body exceeds {MAX_REQUEST_BYTES} bytes.")
        try:
            return await call_next(request)
        except Exception:
            logger.exception("Unhandled error on %s %s", request.method, request.url.path)
            return _error(500, "internal_error", "Unexpected server error. Details are in the backend log.")

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PATCH"],
                       allow_headers=["Content-Type"])

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        code = {400: "bad_request", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
                409: "conflict"}.get(exc.status_code, "error")
        return _error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return _error(422, "validation_error", "Request failed validation.", details)

    @app.get("/api/health", response_model=Health, response_model_exclude_unset=True)
    def health(check_model: bool = False) -> Health:
        if check_model and isinstance(analyzer, GemmaAnalyzer):
            probe_cache["last"] = ModelProbe(**analyzer.probe())
        model = ModelInfo(provider="Google Gen AI (hosted Gemma)", model_id=settings.gemma_model,
                          configured=settings.model_configured, timeout_seconds=settings.model_timeout_seconds,
                          thinking_level=settings.gemma_thinking_level)
        if "last" in probe_cache:
            model.last_probe = probe_cache["last"]
        return Health(status="ok", database=store.ping(), model=model,
                      limits=Limits(max_task_chars=MAX_TASK_CHARS, max_document_chars=MAX_DOCUMENT_CHARS))

    @app.get("/api/scenarios", response_model=ScenarioList)
    def scenarios() -> ScenarioList:
        return ScenarioList(scenarios=SCENARIOS)

    @app.get("/api/tools", response_model=ToolList)
    def tools() -> ToolList:
        return ToolList(tools=[t.public_info() for t in registry.values()])

    @app.post("/api/simulations/run", response_model=AuditEvent)
    def run_simulation(body: SimulationRequest) -> AuditEvent:
        try:
            return gateway.run(body)
        except RequestError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/audit", response_model=AuditPage)
    def list_audit(
        decision: Optional[str] = Query(None, pattern="^(allow|block|needs_approval)$"),
        severity: Optional[str] = Query(None, pattern="^(none|low|medium|high|critical|unassessed)$"),
        scenario: Optional[str] = Query(None, max_length=64),
        q: Optional[str] = Query(None, max_length=100),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ) -> AuditPage:
        items, total = store.list_events(decision, severity, scenario, q, limit, offset)
        return AuditPage(items=items, total=total, limit=limit, offset=offset)

    @app.get("/api/audit/{event_id}", response_model=AuditEvent)
    def get_audit(event_id: str) -> AuditEvent:
        event = store.get_event(event_id)
        if event is None:
            raise HTTPException(status_code=404, detail=f"event '{event_id}' not found")
        return event

    @app.get("/api/policies", response_model=PolicyList)
    def list_policies() -> PolicyList:
        return PolicyList(policies=store.list_policies(), changes=store.list_policy_changes(20))

    @app.post("/api/policies/reset", response_model=PolicyList)
    def reset_policies() -> PolicyList:
        store.reset_policies()
        return list_policies()

    @app.patch("/api/policies/{policy_id}", response_model=PolicyRecord)
    def update_policy(policy_id: str, body: PolicyUpdate) -> PolicyRecord:
        current = store.get_policy(policy_id)
        if current is None:
            raise HTTPException(status_code=404, detail=f"policy '{policy_id}' not found")
        if body.enabled is False and current.locked:
            raise HTTPException(status_code=403, detail=f"policy '{policy_id}' is locked and cannot be disabled")
        config = current.config
        if body.config is not None:
            try:
                config = validate_policy_config(policy_id, body.config, registry)
            except PolicyConfigError as exc:
                return _error(422, "invalid_policy_config", "Policy configuration is invalid.", exc.args[0])
        enabled = current.enabled if body.enabled is None else body.enabled
        return store.update_policy(policy_id, enabled, config)

    @app.get("/api/metrics", response_model=Metrics)
    def metrics() -> Metrics:
        return Metrics(**store.metrics())

    return app


app = create_app()
