"""SQLite persistence for policies, policy changes and audit events."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from .policy import DEFAULT_POLICIES, POLICY_ORDER
from .schemas import AuditEvent, PolicyRecord

SCHEMA = """
CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    locked INTEGER NOT NULL,
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_id TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    before TEXT NOT NULL,
    after TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    scenario_id TEXT,
    tool_name TEXT NOT NULL,
    decision TEXT NOT NULL,
    matched_policy TEXT,
    severity TEXT,
    risk_category TEXT,
    analysis_source TEXT NOT NULL,
    analysis_status TEXT NOT NULL,
    execution_status TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(SCHEMA)
        self._seed_policies()

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.path), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with self._lock:
                yield conn
                conn.commit()
        finally:
            conn.close()

    def ping(self) -> bool:
        with self._conn() as conn:
            return conn.execute("SELECT 1").fetchone()[0] == 1

    # ------------------------------------------------------------------ policies

    def _seed_policies(self) -> None:
        with self._conn() as conn:
            for p in DEFAULT_POLICIES:
                conn.execute(
                    "INSERT OR IGNORE INTO policies (id, name, description, enabled, locked, config, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (p["id"], p["name"], p["description"], int(p["enabled"]), int(p["locked"]),
                     json.dumps(p["config"]), utc_now()),
                )

    def _row_to_policy(self, row: sqlite3.Row) -> PolicyRecord:
        return PolicyRecord(id=row["id"], name=row["name"], description=row["description"],
                            enabled=bool(row["enabled"]), locked=bool(row["locked"]),
                            order=POLICY_ORDER.get(row["id"], 99), config=json.loads(row["config"]),
                            updated_at=row["updated_at"])

    def list_policies(self) -> List[PolicyRecord]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM policies").fetchall()
        return sorted((self._row_to_policy(r) for r in rows), key=lambda p: p.order)

    def policies_by_id(self) -> Dict[str, PolicyRecord]:
        return {p.id: p for p in self.list_policies()}

    def get_policy(self, policy_id: str) -> Optional[PolicyRecord]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM policies WHERE id = ?", (policy_id,)).fetchone()
        return self._row_to_policy(row) if row else None

    def update_policy(self, policy_id: str, enabled: bool, config: Dict[str, Any]) -> PolicyRecord:
        before = self.get_policy(policy_id)
        now = utc_now()
        with self._conn() as conn:
            conn.execute("UPDATE policies SET enabled = ?, config = ?, updated_at = ? WHERE id = ?",
                         (int(enabled), json.dumps(config), now, policy_id))
            conn.execute("INSERT INTO policy_changes (policy_id, changed_at, before, after) VALUES (?, ?, ?, ?)",
                         (policy_id, now, json.dumps({"enabled": before.enabled, "config": before.config}),
                          json.dumps({"enabled": enabled, "config": config})))
        return self.get_policy(policy_id)

    def list_policy_changes(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM policy_changes ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{"id": r["id"], "policy_id": r["policy_id"], "changed_at": r["changed_at"],
                 "before": json.loads(r["before"]), "after": json.loads(r["after"])} for r in rows]

    # ------------------------------------------------------------------ audit

    def save_event(self, event: AuditEvent) -> None:
        a = event.analysis.assessment
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO audit_events (event_id, created_at, scenario_id, tool_name, decision, matched_policy, "
                "severity, risk_category, analysis_source, analysis_status, execution_status, payload) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (event.event_id, event.created_at, event.scenario_id, event.request.tool_call.name,
                 event.policy.decision, event.policy.matched_policy, a.severity if a else None,
                 a.risk_category if a else None, event.analysis.source, event.analysis.status,
                 event.execution.status, event.model_dump_json()),
            )

    def get_event(self, event_id: str) -> Optional[AuditEvent]:
        with self._conn() as conn:
            row = conn.execute("SELECT payload FROM audit_events WHERE event_id = ?", (event_id,)).fetchone()
        return AuditEvent.model_validate_json(row["payload"]) if row else None

    def list_events(self, decision: Optional[str] = None, severity: Optional[str] = None,
                    scenario_id: Optional[str] = None, q: Optional[str] = None,
                    limit: int = 50, offset: int = 0) -> Tuple[List[AuditEvent], int]:
        where, params = [], []
        if decision:
            where.append("decision = ?")
            params.append(decision)
        if severity:
            if severity == "unassessed":
                where.append("severity IS NULL")
            else:
                where.append("severity = ?")
                params.append(severity)
        if scenario_id:
            if scenario_id == "custom":
                where.append("scenario_id IS NULL")
            else:
                where.append("scenario_id = ?")
                params.append(scenario_id)
        if q:
            where.append("(event_id LIKE ? OR tool_name LIKE ? OR payload LIKE ?)")
            like = f"%{q}%"
            params += [like, like, like]
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        with self._conn() as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM audit_events {clause}", params).fetchone()[0]
            rows = conn.execute(f"SELECT payload FROM audit_events {clause} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                                params + [limit, offset]).fetchall()
        return [AuditEvent.model_validate_json(r["payload"]) for r in rows], total

    def metrics(self) -> Dict[str, Any]:
        with self._conn() as conn:
            def count(sql: str, *params: Any) -> int:
                return conn.execute(sql, params).fetchone()[0]

            def group(col: str) -> Dict[str, int]:
                rows = conn.execute(f"SELECT COALESCE({col}, 'unassessed') k, COUNT(*) n FROM audit_events "
                                    f"GROUP BY k").fetchall()
                return {r["k"]: r["n"] for r in rows}

            totals = {
                "total_requests": count("SELECT COUNT(*) FROM audit_events"),
                "allowed": count("SELECT COUNT(*) FROM audit_events WHERE decision = 'allow'"),
                "blocked": count("SELECT COUNT(*) FROM audit_events WHERE decision = 'block'"),
                "needs_approval": count("SELECT COUNT(*) FROM audit_events WHERE decision = 'needs_approval'"),
                "executed": count("SELECT COUNT(*) FROM audit_events WHERE execution_status = 'executed'"),
                "high_risk_incidents": count(
                    "SELECT COUNT(*) FROM audit_events WHERE severity IN ('high', 'critical')"),
                "model_failures": count(
                    "SELECT COUNT(*) FROM audit_events WHERE analysis_status IN "
                    "('error', 'timeout', 'invalid_response', 'not_configured')"),
            }
            matched = conn.execute("SELECT matched_policy k, COUNT(*) n FROM audit_events "
                                   "WHERE matched_policy IS NOT NULL GROUP BY k ORDER BY n DESC").fetchall()
            activity = conn.execute("SELECT created_at, decision FROM audit_events ORDER BY created_at").fetchall()
            times, decisions = [r[0] for r in activity], [r[1] for r in activity]
            grouped = {
                "by_decision": group("decision"),
                "by_severity": group("severity"),
                "by_analysis_status": group("analysis_status"),
            }
        return {
            **totals,
            **grouped,
            "by_matched_policy": {r["k"]: r["n"] for r in matched},
            "timeline": _timeline(times, decisions),
        }


def _timeline(times: List[str], decisions: List[str]) -> Dict[str, Any]:
    """Bucket events by a granularity that suits the span of recorded activity."""
    if not times:
        return {"bucket": None, "points": []}
    parsed = [datetime.fromisoformat(t) for t in times]
    span = parsed[-1] - parsed[0]
    if span <= timedelta(hours=2):
        size, label = timedelta(minutes=5), "5m"
    elif span <= timedelta(days=2):
        size, label = timedelta(hours=1), "1h"
    else:
        size, label = timedelta(days=1), "1d"
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    buckets: Dict[datetime, Dict[str, int]] = {}
    for t, d in zip(parsed, decisions):
        start = epoch + ((t - epoch) // size) * size
        b = buckets.setdefault(start, {"allow": 0, "block": 0, "needs_approval": 0})
        b[d] = b.get(d, 0) + 1
    first, last = min(buckets), max(buckets)
    points, cur = [], first
    while cur <= last and len(points) < 500:  # fill gaps so the chart has a continuous axis
        b = buckets.get(cur, {"allow": 0, "block": 0, "needs_approval": 0})
        points.append({"bucket_start": cur.isoformat(), **b})
        cur += size
    return {"bucket": label, "points": points}
