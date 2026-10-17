"""The enforcement gateway: analyze -> decide -> (maybe) execute -> audit.

This is the single route to tool execution. It owns the permit issuer and the
executor, created together with a per-process secret.
"""
from __future__ import annotations

import secrets
import uuid
from typing import Dict, Optional

from .analyzer import Analyzer, FixtureAnalyzer
from .policy import PolicyEngine
from .scenarios import FIXTURES, get_scenario
from .schemas import (AnalysisResult, AuditEvent, ExecutionResult, ModelVsPolicy, ResolvedRequest, SimulationRequest, ToolCall)
from .store import Store, utc_now
from .tools import PermitIssuer, ToolExecutor, ToolSpec


class RequestError(ValueError):
    pass


class Gateway:
    def __init__(self, registry: Dict[str, ToolSpec], store: Store, analyzer: Analyzer):
        self.registry = registry
        self.store = store
        self.analyzer = analyzer
        self.engine = PolicyEngine(registry)
        key = secrets.token_bytes(32)
        self._issuer = PermitIssuer(key)
        self._executor = ToolExecutor(registry, key)

    def resolve(self, req: SimulationRequest) -> ResolvedRequest:
        scenario = get_scenario(req.scenario_id) if req.scenario_id else None
        if req.scenario_id and scenario is None:
            raise RequestError(f"unknown scenario '{req.scenario_id}'")
        if scenario is None and (req.task is None or req.tool_call is None):
            raise RequestError("task and tool_call are required when no scenario_id is given")
        s = scenario or {}
        return ResolvedRequest(
            scenario_id=req.scenario_id,
            task=req.task if req.task is not None else s["task"],
            document=req.document if req.document is not None else s.get("document", ""),
            tool_call=req.tool_call or ToolCall.model_validate(s["tool_call"]),
            human_approval=req.human_approval if req.human_approval is not None else s.get("human_approval", False),
        )

    def run(self, req: SimulationRequest, analyzer_override: Optional[Analyzer] = None) -> AuditEvent:
        resolved = self.resolve(req)
        event_id = f"evt_{uuid.uuid4().hex}"
        spec = self.registry.get(resolved.tool_call.name)

        analyzer = analyzer_override or self.analyzer
        if resolved.scenario_id in FIXTURES:
            analyzer = FixtureAnalyzer(FIXTURES[resolved.scenario_id], label="permissive-model-fixture")
        try:
            analysis = analyzer.analyze(resolved)
        except Exception as exc:  # an analyzer bug must not become an allow
            analysis = AnalysisResult(source="none", status="error", error=f"analyzer crashed: {type(exc).__name__}")

        decision, validated_args = self.engine.evaluate(resolved.tool_call, analysis, self.store.policies_by_id(),
                                                        resolved.human_approval)

        if decision.decision == "allow" and validated_args is not None and spec is not None:
            permit = self._issuer.issue(event_id, spec.name, validated_args, decision)
            execution = self._executor.execute(permit)
        else:
            execution = ExecutionResult(status="not_executed")

        recommendation = analysis.assessment.recommendation if analysis.usable else None
        event = AuditEvent(
            event_id=event_id,
            created_at=utc_now(),
            scenario_id=resolved.scenario_id,
            request=resolved,
            tool_sensitivity=spec.sensitivity if spec else None,
            analysis=analysis,
            policy=decision,
            execution=execution,
            model_vs_policy=ModelVsPolicy(
                model_recommendation=recommendation,
                policy_decision=decision.decision,
                agreement=None if recommendation is None or recommendation == "review"
                else (recommendation == "allow") == (decision.decision == "allow"),
            ),
        )
        self.store.save_event(event)
        return event
