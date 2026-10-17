import { useEffect, useState } from "react";
import { History, Inbox, Loader2, Lock, Play, Plus, Save, ShieldCheck, X } from "lucide-react";
import { api } from "../api";
import type { AuditEvent, Policy, Scenario, ToolInfo } from "../types";
import { Badge, Button, Card, DECISION_LABEL, DecisionBadge, EmptyState, ErrorState, Label, Mono, Skeleton, cx, formatTime, useAsync, PageHeader } from "../components/ui";

type Patch = { enabled?: boolean; config?: Record<string, unknown> };

export default function Policies() {
  const data = useAsync(() => api.policies());
  const tools = useAsync(() => api.tools());
  const [historyError, setHistoryError] = useState<string | null>(null);

  const replacePolicy = (id: string, next: Policy) =>
    data.setData((cur) => cur && { ...cur, policies: cur.policies.map((p) => (p.id === id ? next : p)) });

  const refreshHistory = () =>
    api.policies()
      .then((r) => { data.setData((cur) => cur && { ...cur, changes: r.changes }); setHistoryError(null); })
      .catch((e: Error) => setHistoryError(e.message));

  /** Optimistic update: show the change at once, then confirm with the server or roll back. */
  const applyPatch = async (id: string, patch: Patch): Promise<string | null> => {
    const previous = data.data?.policies.find((p) => p.id === id);
    if (!previous) return "Policy not loaded.";
    replacePolicy(id, { ...previous, ...patch });
    try {
      replacePolicy(id, await api.updatePolicy(id, patch));
      refreshHistory();
      return null;
    } catch (e) {
      replacePolicy(id, previous);
      return (e as Error).message;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Policies"
        subtitle="Stored and enforced by the backend. Changes are validated server-side and apply to the next request." />
      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
      {tools.error && !data.error && <ErrorState message={`Could not load tools: ${tools.error}`} onRetry={tools.reload} />}
      {(data.loading || tools.loading) && !(data.data && tools.data) && !data.error && !tools.error && (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]" aria-busy aria-label="Loading policies">
          <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
          <Skeleton className="h-64" />
        </div>
      )}
      {data.data && data.data.policies.length === 0 && (
        <Card><EmptyState icon={<Inbox size={28} />} title="No policies configured">
          The backend seeds default policies on startup. Restart it, or check the database path in <Mono>backend/.env</Mono>.
        </EmptyState></Card>
      )}
      {data.data && tools.data && data.data.policies.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0 space-y-3">
            {data.data.policies.map((p, i) => (
              <PolicyCard key={p.id} index={i + 1} policy={p} tools={tools.data!} onPatch={(patch) => applyPatch(p.id, patch)} />
            ))}
          </div>
          <div className="min-w-0 space-y-4">
            <ImpactRunner />
            <Card title="Change history" icon={<History size={16} />}>
              {historyError && <div className="mb-3"><ErrorState message={historyError} onRetry={refreshHistory} /></div>}
              {data.data.changes.length === 0 ? <p className="text-sm text-fg-muted">No policy changes yet.</p> : (
                <ul className="space-y-3 text-sm">
                  {data.data.changes.map((c) => (
                    <li key={c.id} className="border-l-2 border-ink-600 pl-3">
                      <div className="flex justify-between gap-2"><Mono className="text-fg">{c.policy_id}</Mono>
                        <span className="text-xs text-fg-faint">{formatTime(c.changed_at)}</span></div>
                      <div className="mt-1 text-xs text-fg-muted">{describeChange(c.before, c.after)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function describeChange(before: { enabled: boolean; config: Record<string, unknown> }, after: { enabled: boolean; config: Record<string, unknown> }) {
  const parts: string[] = [];
  if (before.enabled !== after.enabled) parts.push(after.enabled ? "enabled" : "disabled");
  for (const k of new Set([...Object.keys(before.config), ...Object.keys(after.config)])) {
    const b = JSON.stringify(before.config[k]), a = JSON.stringify(after.config[k]);
    if (b !== a) parts.push(`${k}: ${b} → ${a}`);
  }
  return parts.join("; ") || "no effective change";
}

function PolicyCard({ policy, tools, index, onPatch }: { policy: Policy; tools: ToolInfo[]; index: number; onPatch: (p: Patch) => Promise<string | null> }) {
  const [config, setConfig] = useState<Record<string, unknown>>(policy.config);
  const [pending, setPending] = useState<"toggle" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ kind: "toggle" | "save"; patch: Patch } | null>(null);
  // Reset the draft only when the server confirms a change, so a rolled-back edit stays editable.
  useEffect(() => { setConfig(policy.config); }, [policy.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(config) !== JSON.stringify(policy.config);
  const run = async (kind: "toggle" | "save", patch: Patch) => {
    setPending(kind); setError(null);
    const err = await onPatch(patch);
    if (err) {
      setError(`${kind === "toggle" ? "Could not change status" : "Could not save"}: ${err} The previous value was restored.`);
      setFailed({ kind, patch });
    } else setFailed(null);
    setPending(null);
  };
  const set = (k: string, v: unknown) => setConfig({ ...config, [k]: v });

  return (
    <section className={cx("rounded-lg border bg-ink-900", policy.enabled ? "border-ink-700" : "border-dashed border-ink-600 opacity-80")}
      aria-labelledby={`policy-${policy.id}`}>
      <div className="flex items-start gap-3 p-4 sm:gap-4">
        <span className="mt-0.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded bg-ink-800 font-mono text-xs text-fg-muted sm:flex">{index}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`policy-${policy.id}`} className="text-sm font-semibold">{policy.name}</h3>
            <Mono className="break-all text-fg-faint">{policy.id}</Mono>
            {policy.locked && <Badge icon={<Lock size={11} />} title="Core security control; cannot be disabled">Locked</Badge>}
            {policy.enabled ? <Badge tone="good">Enforced</Badge> : <Badge tone="warn">Disabled</Badge>}
            {pending && <span className="flex items-center gap-1 text-[11px] text-fg-faint" role="status"><Loader2 size={12} className="animate-spin" /> Saving…</span>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{policy.description}</p>
          <div className="mt-3"><ConfigEditor policy={policy} config={config} set={set} tools={tools} /></div>
          {error && <div className="mt-3"><ErrorState message={error} onRetry={failed ? () => run(failed.kind, failed.patch) : undefined} /></div>}
          {dirty && (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={() => run("save", { config })} disabled={pending !== null}><Save size={14} /> Save</Button>
              <Button variant="ghost" onClick={() => { setConfig(policy.config); setError(null); setFailed(null); }}>Discard</Button>
            </div>
          )}
        </div>
        <Toggle checked={policy.enabled} disabled={policy.locked || pending !== null}
          onChange={(v) => run("toggle", { enabled: v })} label={`Enable ${policy.name}`} />
      </div>
    </section>
  );
}

function ConfigEditor({ policy, config, set, tools }: { policy: Policy; config: Record<string, unknown>; set: (k: string, v: unknown) => void; tools: ToolInfo[] }) {
  switch (policy.id) {
    case "tool_allowlist": {
      const allowed = (config.allowed_tools as string[]) ?? [];
      return (
        <div><Label>Allowlisted tools</Label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {tools.map((t) => (
              <label key={t.name} className="flex items-center gap-2 rounded border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm">
                <input type="checkbox" className="accent-[#5b9cf2]" checked={allowed.includes(t.name)}
                  onChange={(e) => set("allowed_tools", e.target.checked ? [...allowed, t.name].sort() : allowed.filter((x) => x !== t.name))} />
                <Mono className="text-fg">{t.name}</Mono>
                <span className="ml-auto text-[11px] text-fg-faint">{t.sensitivity.replace("_", " ")}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case "approved_destinations":
      return <DomainEditor domains={(config.allowed_domains as string[]) ?? []} onChange={(d) => set("allowed_domains", d)} />;
    case "model_analysis_required":
      return <Check label="Read-only tools may run without model analysis" checked={!!config.exempt_read_only} onChange={(v) => set("exempt_read_only", v)} />;
    case "model_risk_gate":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <div><Label>Block at or above</Label>
            <select value={config.block_at_or_above as string} onChange={(e) => set("block_at_or_above", e.target.value)}
              className="rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-sm">
              {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div><Label>Applies to</Label>
            <select value={config.applies_to as string} onChange={(e) => set("applies_to", e.target.value)}
              className="rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-sm">
              <option value="sensitive_only">Sensitive tools only</option><option value="all_tools">All tools</option>
            </select></div>
          <Check label="Also block when the model recommends blocking" checked={!!config.honor_block_recommendation} onChange={(v) => set("honor_block_recommendation", v)} />
        </div>
      );
    case "sensitive_action_approval": {
      const req = (config.require_for as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-4">
          {["sensitive", "destructive"].map((s) => (
            <Check key={s} label={`Require approval for ${s} tools`} checked={req.includes(s)}
              onChange={(v) => set("require_for", v ? [...req, s] : req.filter((x) => x !== s))} />
          ))}
        </div>
      );
    }
    default:
      return <p className="text-xs text-fg-faint">No configurable options.</p>;
  }
}

function DomainEditor({ domains, onChange }: { domains: string[]; onChange: (d: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const d = draft.trim().toLowerCase(); if (d && !domains.includes(d)) onChange([...domains, d].sort()); setDraft(""); };
  return (
    <div><Label>Approved domains (subdomains included)</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {domains.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded border border-ink-600 bg-ink-850 py-0.5 pl-2 pr-1 font-mono text-[12px]">
            {d}<button onClick={() => onChange(domains.filter((x) => x !== d))} aria-label={`Remove ${d}`} className="rounded p-0.5 text-fg-faint hover:text-fg"><X size={12} /></button>
          </span>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-1">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="partner.example" maxLength={253}
            className="w-40 rounded border border-ink-600 bg-ink-950 px-2 py-0.5 font-mono text-[12px] outline-none focus:border-accent" />
          <Button type="submit" variant="ghost" className="px-1.5 py-0.5" aria-label="Add domain"><Plus size={14} /></Button>
        </form>
      </div>
    </div>
  );
}

function ImpactRunner() {
  const [runs, setRuns] = useState<{ scenario: Scenario; event?: AuditEvent; error?: string }[] | null>(null);
  const [running, setRunning] = useState(false);
  const runAll = async () => {
    setRunning(true);
    const scenarios = await api.scenarios().catch(() => []);
    const out: { scenario: Scenario; event?: AuditEvent; error?: string }[] = [];
    for (const s of scenarios) {
      try { out.push({ scenario: s, event: await api.run({ scenario_id: s.id }) }); }
      catch (e) { out.push({ scenario: s, error: (e as Error).message }); }
      setRuns([...out]);
    }
    setRunning(false);
  };
  return (
    <Card title="Policy impact" icon={<ShieldCheck size={16} />}
      actions={<Button onClick={runAll} disabled={running}><Play size={14} /> {running ? "Running…" : "Rerun all scenarios"}</Button>}>
      {!runs ? <p className="text-sm text-fg-muted">Rerun the four scenarios against the current policies. Each run is recorded in the audit log.</p> : (
        <ul className="divide-y divide-ink-700 text-sm">
          {runs.map(({ scenario: s, event, error }) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="font-mono text-xs text-fg-faint">{s.label}</span> {s.title}
                {event && event.policy.decision !== s.expected && <span className="block text-[11px] text-warn">Differs from default expectation ({DECISION_LABEL[s.expected]})</span>}
                {event?.policy.matched_policy && <span className="block text-[11px] text-fg-faint">by {event.policy.matched_policy}</span>}
              </span>
              {event ? <DecisionBadge decision={event.policy.decision} /> : <span className="text-xs text-[#ff6b70]">{error}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      title={disabled ? "Locked policy" : undefined}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50", checked ? "bg-accent" : "bg-ink-600")}>
      <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="accent-[#5b9cf2]" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}
    </label>
  );
}
