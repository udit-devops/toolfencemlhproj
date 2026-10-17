import { useEffect, useState } from "react";
import { History, Lock, Play, Plus, Save, ShieldCheck, X } from "lucide-react";
import { api } from "../api";
import type { AuditEvent, Policy, Scenario, ToolInfo } from "../types";
import { Badge, Button, Card, DECISION_LABEL, DecisionBadge, ErrorState, Label, Mono, Spinner, cx, formatTime, useAsync, PageHeader } from "../components/ui";

export default function Policies() {
  const data = useAsync(() => api.policies());
  const tools = useAsync(() => api.tools());

  return (
    <div className="space-y-6">
      <PageHeader title="Policies"
        subtitle="Stored and enforced by the backend. Changes are validated server-side and apply to the next request." />
      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}
      {(data.loading || tools.loading) && !data.data && <Spinner />}
      {data.data && tools.data && (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {data.data.policies.map((p, i) => (
              <PolicyCard key={p.id} index={i + 1} policy={p} tools={tools.data!} onSaved={data.reload} />
            ))}
          </div>
          <div className="space-y-4">
            <ImpactRunner />
            <Card title="Change history" icon={<History size={16} />}>
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

function PolicyCard({ policy, tools, index, onSaved }: { policy: Policy; tools: ToolInfo[]; index: number; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>(policy.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEnabled(policy.enabled); setConfig(policy.config); }, [policy]);

  const dirty = enabled !== policy.enabled || JSON.stringify(config) !== JSON.stringify(policy.config);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await api.updatePolicy(policy.id, { ...(enabled !== policy.enabled && { enabled }), config });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const set = (k: string, v: unknown) => setConfig({ ...config, [k]: v });

  return (
    <section className={cx("rounded-lg border bg-ink-900", enabled ? "border-ink-700" : "border-dashed border-ink-600 opacity-80")}>
      <div className="flex items-start gap-4 p-4">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ink-800 font-mono text-xs text-fg-muted">{index}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{policy.name}</h3>
            <Mono className="text-fg-faint">{policy.id}</Mono>
            {policy.locked && <Badge icon={<Lock size={11} />} title="Core security control; cannot be disabled">Locked</Badge>}
            {enabled ? <Badge tone="good">Enforced</Badge> : <Badge tone="warn">Disabled</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">{policy.description}</p>
          <div className="mt-3"><ConfigEditor policy={policy} config={config} set={set} tools={tools} /></div>
          {error && <div className="mt-3"><ErrorState message={error} /></div>}
          {dirty && (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save"}</Button>
              <Button variant="ghost" onClick={() => { setEnabled(policy.enabled); setConfig(policy.config); setError(null); }}>Discard</Button>
            </div>
          )}
        </div>
        <Toggle checked={enabled} disabled={policy.locked} onChange={setEnabled} label={`Enable ${policy.name}`} />
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
