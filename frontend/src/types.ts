// Mirrors backend/app/schemas.py.

export type Severity = "none" | "low" | "medium" | "high" | "critical";
export type Decision = "allow" | "block" | "needs_approval";
export type CheckOutcome = "pass" | "fail" | "approval_required" | "not_applicable" | "skipped" | "disabled";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  label: string;
  title: string;
  summary: string;
  expected: Decision;
  task: string;
  document: string;
  tool_call: ToolCall;
  human_approval: boolean;
  analysis: "live" | "fixture";
}

export interface ThreatAssessment {
  risk_category: string;
  severity: Severity;
  confidence: number;
  recommendation: "allow" | "block" | "review";
  task_alignment: "aligned" | "misaligned" | "unclear";
  explanation: string;
  suspicious_excerpts: string[];
}

export interface AnalysisResult {
  source: "live_model" | "test_fixture" | "none";
  status: "ok" | "fixture" | "error" | "timeout" | "invalid_response" | "not_configured";
  model: string | null;
  latency_ms: number | null;
  assessment: ThreatAssessment | null;
  excerpts_verified: boolean[];
  error: string | null;
  raw_response_excerpt: string | null;
}

export interface PolicyCheck {
  policy_id: string;
  policy_name: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface AuditEvent {
  event_id: string;
  created_at: string;
  scenario_id: string | null;
  request: { scenario_id: string | null; task: string; document: string; tool_call: ToolCall; human_approval: boolean };
  tool_sensitivity: string | null;
  analysis: AnalysisResult;
  policy: { decision: Decision; matched_policy: string | null; reason: string; checks: PolicyCheck[] };
  execution: { status: "executed" | "not_executed" | "failed"; output: unknown; error: string | null };
  model_vs_policy: { model_recommendation: string | null; policy_decision: Decision; agreement: boolean | null };
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  locked: boolean;
  order: number;
  config: Record<string, unknown>;
  updated_at: string;
}

export interface PolicyChange {
  id: number;
  policy_id: string;
  changed_at: string;
  before: { enabled: boolean; config: Record<string, unknown> };
  after: { enabled: boolean; config: Record<string, unknown> };
}

export interface ToolInfo {
  name: string;
  description: string;
  sensitivity: "read_only" | "sensitive" | "destructive";
  destination_field: string | null;
}

export interface Metrics {
  total_requests: number;
  allowed: number;
  blocked: number;
  needs_approval: number;
  executed: number;
  high_risk_incidents: number;
  model_failures: number;
  by_decision: Record<string, number>;
  by_severity: Record<string, number>;
  by_analysis_status: Record<string, number>;
  by_matched_policy: Record<string, number>;
  timeline: { bucket: string | null; points: { bucket_start: string; allow: number; block: number; needs_approval: number }[] };
}

export interface Health {
  status: string;
  database: boolean;
  model: {
    provider: string;
    model_id: string;
    configured: boolean;
    timeout_seconds: number;
    last_probe?: { ok: boolean; latency_ms?: number; error?: string; reply_excerpt?: string };
  };
  limits: { max_task_chars: number; max_document_chars: number };
}
