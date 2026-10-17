import type { AuditEvent, AuditPage, Health, Metrics, Policy, PolicyChange, Scenario, ToolCall, ToolInfo } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError(0, "Cannot reach the ToolFence backend. Is it running on port 8000?", "network_error");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok && body === null) {
    // A non-JSON error (e.g. a static host's 404 page) means no ToolFence API is behind /api.
    throw new ApiError(res.status, "The ToolFence backend is not connected to this deployment.", "backend_not_connected");
  }
  if (!res.ok) {
    const err = body?.error;
    const details = Array.isArray(err?.details)
      ? err.details.map((d: { loc?: unknown[]; msg?: string } | string) =>
          typeof d === "string" ? d : `${(d.loc ?? []).join(".")}: ${d.msg ?? ""}`).join("; ")
      : typeof err?.details === "string" ? err.details : "";
    const message = err?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, details ? `${message} ${details}` : message, err?.code, err?.details);
  }
  return body as T;
}

export interface RunRequest {
  scenario_id?: string;
  task?: string;
  document?: string;
  tool_call?: ToolCall;
  human_approval?: boolean;
}

export interface AuditQuery {
  decision?: string;
  severity?: string;
  scenario?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  health: (checkModel = false) => request<Health>(`/api/health${checkModel ? "?check_model=true" : ""}`),
  scenarios: () => request<{ scenarios: Scenario[] }>("/api/scenarios").then((r) => r.scenarios),
  tools: () => request<{ tools: ToolInfo[] }>("/api/tools").then((r) => r.tools),
  run: (body: RunRequest) => request<AuditEvent>("/api/simulations/run", { method: "POST", body: JSON.stringify(body) }),
  audit: (q: AuditQuery) => {
    const params = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    return request<AuditPage>(`/api/audit?${params}`);
  },
  event: (id: string) => request<AuditEvent>(`/api/audit/${encodeURIComponent(id)}`),
  policies: () => request<{ policies: Policy[]; changes: PolicyChange[] }>("/api/policies"),
  updatePolicy: (id: string, patch: { enabled?: boolean; config?: Record<string, unknown> }) =>
    request<Policy>(`/api/policies/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  metrics: () => request<Metrics>("/api/metrics"),
};
