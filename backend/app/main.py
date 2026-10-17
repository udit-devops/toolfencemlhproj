"""FastAPI application exposing the ToolFence gateway."""
from __future__ import annotations

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
from .schemas import AuditEvent, PolicyRecord, PolicyUpdate, SimulationRequest
from .store import Store
from .tools import build_registry


def _error(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details}})


def create_app(settings: Optional[Settings] = None, analyzer: Optional[Analyzer] = None) -> FastAPI:
    settings = settings or load_settings()
    registry = build_registry()
    store = Store(settings.database_path)
    analyzer = analyzer or GemmaAnalyzer(settings.gemini_api_key if settings.model_configured else None,
                                         settings.gemma_model, settings.model_timeout_seconds)
    gateway = Gateway(registry, store, analyzer)
    probe_cache: Dict[str, Any] = {}

    app = FastAPI(title="ToolFence", version="1.0.0",
                  description="Runtime security gateway for AI agent tool calls.")
    app.state.gateway = gateway
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PATCH"],
                       allow_headers=["Content-Type"])

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
            return _error(413, "payload_too_large", f"Request body exceeds {MAX_REQUEST_BYTES} bytes.")
        return await call_next(request)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        code = {400: "bad_request", 403: "forbidden", 404: "not_found", 409: "conflict"}.get(exc.status_code, "error")
        return _error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return _error(422, "validation_error", "Request failed validation.", details)

    @app.get("/api/health")
    def health(check_model: bool = False) -> Dict[str, Any]:
        model: Dict[str, Any] = {
            "provider": "Google Gen AI (hosted Gemma)",
            "model_id": settings.gemma_model,
            "configured": settings.model_configured,
            "timeout_seconds": settings.model_timeout_seconds,
        }
        if check_model and isinstance(analyzer, GemmaAnalyzer):
            probe_cache["last"] = analyzer.probe()
        if "last" in probe_cache:
            model["last_probe"] = probe_cache["last"]
        return {"status": "ok", "database": store.ping(), "model": model,
                "limits": {"max_task_chars": MAX_TASK_CHARS, "max_document_chars": MAX_DOCUMENT_CHARS}}

    @app.get("/api/scenarios")
    def scenarios() -> Dict[str, Any]:
        return {"scenarios": SCENARIOS}

    @app.get("/api/tools")
    def tools() -> Dict[str, Any]:
        return {"tools": [t.public_info() for t in registry.values()]}

    @app.post("/api/simulations/run", response_model=AuditEvent)
    def run_simulation(body: SimulationRequest) -> AuditEvent:
        try:
            return gateway.run(body)
        except RequestError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/audit")
    def list_audit(
        decision: Optional[str] = Query(None, pattern="^(allow|block|needs_approval)$"),
        severity: Optional[str] = Query(None, pattern="^(none|low|medium|high|critical|unassessed)$"),
        scenario: Optional[str] = Query(None, max_length=64),
        q: Optional[str] = Query(None, max_length=100),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ) -> Dict[str, Any]:
        items, total = store.list_events(decision, severity, scenario, q, limit, offset)
        return {"items": [i.model_dump() for i in items], "total": total, "limit": limit, "offset": offset}

    @app.get("/api/audit/{event_id}", response_model=AuditEvent)
    def get_audit(event_id: str) -> AuditEvent:
        event = store.get_event(event_id)
        if event is None:
            raise HTTPException(status_code=404, detail=f"event '{event_id}' not found")
        return event

    @app.get("/api/policies")
    def list_policies() -> Dict[str, Any]:
        return {"policies": [p.model_dump() for p in store.list_policies()],
                "changes": store.list_policy_changes(20)}

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

    @app.get("/api/metrics")
    def metrics() -> Dict[str, Any]:
        return store.metrics()

    return app


app = create_app()
