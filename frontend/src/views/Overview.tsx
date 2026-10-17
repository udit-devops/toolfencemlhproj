import { useState } from "react";
import { Activity, Ban, CheckCircle2, Inbox, Pause, Play, RefreshCw, ShieldAlert } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import type { AuditEvent, Metrics } from "../types";
import { Button, Card, DecisionBadge, PageHeader, EmptyState, ErrorState, Mono, SeverityBadge, Skeleton, cx, formatTime, humanize, useAsync, usePolling } from "../components/ui";

// Reserved status colors (paired with labels/icons, never color alone); accent for volume.
const C = {
  allow: "#2fbf5b", needs_approval: "#fab219", block: "#e5484d", accent: "#4c6ef5",
  grid: "#2a2a2f", axis: "#818188", label: "#a2a2a8", surface: "#1c1c1f",
};
const SEVERITY_COLORS: Record<string, string> = {
  unassessed: "#4a4a50", none: "#64646b", low: "#8a8a92", medium: "#fab219", high: "#ec835a", critical: "#e5484d",
};
const SEVERITIES = ["unassessed", "none", "low", "medium", "high", "critical"];
const ANALYSIS_ROWS: { key: string; label: string; color: string }[] = [
  { key: "ok", label: "Live Gemma analysis", color: C.allow },
  { key: "fixture", label: "Test fixture", color: C.accent },
  { key: "not_configured", label: "Model not configured", color: C.needs_approval },
  { key: "timeout", label: "Timed out", color: "#ec835a" },
  { key: "error", label: "Model error", color: C.block },
  { key: "invalid_response", label: "Invalid model output", color: C.block },
];
const BUCKET_LABEL: Record<string, string> = { "5m": "5-minute buckets", "1h": "Hourly", "1d": "Daily" };
const REFRESH_MS = 10_000;
const axisTick = { fill: C.axis, fontSize: 11 };

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const timeTick = (t: string) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Overview() {
  const metrics = useAsync(() => api.metrics());
  const recent = useAsync(() => api.audit({ limit: 8 }));
  const refresh = () => { metrics.reload(); recent.reload(); };
  const [auto, setAuto] = useState(true);
  const { hidden } = usePolling(refresh, REFRESH_MS, auto);
  const m = metrics.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Live security posture, computed from the persisted audit log."
        actions={<>
          <span className="hidden text-xs text-fg-faint sm:inline" aria-live="polite">
            {!auto ? "Auto-refresh off" : hidden ? "Paused while tab is hidden" : "Refreshes every 10 s"}
            {metrics.updatedAt && <> · {metrics.updatedAt.toLocaleTimeString()}</>}
          </span>
          <Button onClick={() => setAuto(!auto)} aria-pressed={auto} title={auto ? "Pause auto-refresh" : "Resume auto-refresh"}>
            {auto ? <Pause size={14} /> : <Play size={14} />} {auto ? "Pause" : "Resume"}
          </Button>
          <Button onClick={refresh} disabled={metrics.loading} aria-label="Refresh now">
            <RefreshCw size={14} className={metrics.loading ? "animate-spin" : ""} /> Refresh
          </Button>
        </>} />

      {metrics.error && <ErrorState message={metrics.error} onRetry={refresh} />}
      {metrics.loading && !m && !metrics.error && <OverviewSkeleton />}

      {m && (
        <>
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total requests" value={m.total_requests} icon={<Activity size={15} />}
              hint={<><span className="text-fg">{m.executed}</span> tool calls executed</>} />
            <Stat label="Allowed" value={m.allowed} icon={<CheckCircle2 size={15} />}
              hint={<><span className="text-good">{pct(m.allowed, m.total_requests)}%</span> of all requests</>} />
            <Stat label="Blocked" value={m.blocked} icon={<Ban size={15} />}
              hint={<><span className="text-bad-fg">{pct(m.blocked, m.total_requests)}%</span> of all requests
                {m.needs_approval > 0 && <> · {m.needs_approval} awaiting approval</>}</>} />
            <Stat label="High-risk incidents" value={m.high_risk_incidents} icon={<ShieldAlert size={15} />}
              hint={<>Assessed <span className="text-serious">high</span> or <span className="text-bad-fg">critical</span></>} />
          </div>

          {m.total_requests === 0 ? (
            <Card><EmptyState icon={<Inbox size={22} />} title="No activity recorded yet">
              Run a scenario from the <a className="text-accent-soft underline" href="#/simulator">attack simulator</a> to generate real audit events.
            </EmptyState></Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-12">
              <Card title="Request volume" subtitle="Tool calls received by the gateway" className="lg:col-span-7"
                actions={<Chip>{BUCKET_LABEL[m.timeline.bucket ?? ""] ?? "—"}</Chip>}>
                <VolumeChart m={m} />
              </Card>

              <Card title="Decisions" subtitle="Policy outcome per time bucket" className="lg:col-span-5"
                actions={<Chip>{BUCKET_LABEL[m.timeline.bucket ?? ""] ?? "—"}</Chip>}>
                <DecisionSplit m={m} />
                <div className="mt-4 h-52">
                  <ResponsiveContainer>
                    <BarChart data={m.timeline.points} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="28%">
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="bucket_start" tickFormatter={timeTick} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar isAnimationActive={false} dataKey="allow" name="Allowed" stackId="d" fill={C.allow} stroke={C.surface} strokeWidth={2} maxBarSize={56} />
                      <Bar isAnimationActive={false} dataKey="needs_approval" name="Needs approval" stackId="d" fill={C.needs_approval} stroke={C.surface} strokeWidth={2} maxBarSize={56} />
                      <Bar isAnimationActive={false} dataKey="block" name="Blocked" stackId="d" fill={C.block} stroke={C.surface} strokeWidth={2} radius={[6, 6, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Assessed severity" subtitle="Highest risk the threat model reported per request" className="lg:col-span-7">
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={SEVERITIES.map((s) => ({ severity: s, count: m.by_severity[s] ?? 0 }))}
                      margin={{ top: 18, right: 4, left: -24, bottom: 0 }} barCategoryGap="30%">
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="severity" tick={{ ...axisTick, fill: C.label }} axisLine={false} tickLine={false} interval={0}
                        tickFormatter={(s: string) => (s === "unassessed" ? "Unrated" : s[0].toUpperCase() + s.slice(1))} />
                      <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar isAnimationActive={false} dataKey="count" name="Events" radius={[6, 6, 0, 0]} maxBarSize={64}
                        label={{ position: "top", fill: C.label, fontSize: 11 }}>
                        {SEVERITIES.map((s) => <Cell key={s} fill={SEVERITY_COLORS[s]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Threat analysis" subtitle="How each request was assessed" className="lg:col-span-5">
                <Tracker total={m.total_requests}
                  rows={ANALYSIS_ROWS.filter((r) => m.by_analysis_status[r.key]).map((r) => ({ ...r, n: m.by_analysis_status[r.key] }))}
                  empty="No requests assessed yet." />
                <div className="mt-6 border-t border-ink-700 pt-5">
                  <div className="mb-3 text-[13px] font-medium text-fg">Blocking policies</div>
                  <Tracker total={m.blocked + m.needs_approval}
                    rows={Object.entries(m.by_matched_policy).map(([k, n]) => ({ key: k, label: sentence(humanize(k)), n, color: C.accent }))}
                    empty="No policy has stopped an action yet." />
                </div>
              </Card>

              <Card title="Recent audit events" subtitle="Latest decisions recorded by the gateway" className="lg:col-span-12"
                actions={<a href="#/audit" className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-fg hover:bg-ink-800">View all</a>}
                bodyClassName="px-0 pb-2 pt-4">
                {recent.error && <div className="px-5"><ErrorState message={recent.error} onRetry={recent.reload} /></div>}
                {recent.loading && !recent.data && !recent.error && <div className="space-y-2 px-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>}
                {recent.data && <RecentTable items={recent.data.items} />}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VolumeChart({ m }: { m: Metrics }) {
  const points = m.timeline.points.map((p) => ({ ...p, total: p.allow + p.block + p.needs_approval }));
  if (points.length < 2) {
    const only = points[0];
    return (
      <div className="flex h-[17.5rem] flex-col items-center justify-center gap-1 text-center">
        <div className="text-[34px] font-semibold tabular text-fg">{only?.total ?? 0}</div>
        <p className="text-sm text-fg-muted">requests, all in one {m.timeline.bucket ?? ""} window starting {only ? timeTick(only.bucket_start) : "—"}</p>
        <p className="max-w-xs text-xs text-fg-faint">The trend line appears once activity spans more than one time bucket.</p>
      </div>
    );
  }
  return (
    <div className="h-[17.5rem]">
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.accent} stopOpacity={0.42} />
              <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="bucket_start" tickFormatter={timeTick} tick={axisTick} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.axis, strokeDasharray: "3 3" }} />
          <Area isAnimationActive={false} type="monotone" dataKey="total" name="Requests" stroke={C.accent} strokeWidth={2}
            fill="url(#volumeFill)" activeDot={{ r: 4, stroke: C.surface, strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecentTable({ items }: { items: AuditEvent[] }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="text-xs text-fg-faint">
          <tr className="border-b border-ink-700">
            <th className="px-5 pb-3 font-medium">Time</th><th className="pb-3 font-medium">Scenario</th><th className="pb-3 font-medium">Tool</th>
            <th className="pb-3 font-medium">Severity</th><th className="px-5 pb-3 font-medium">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700/70">
          {items.map((e) => (
            <tr key={e.event_id} className="transition-colors hover:bg-ink-850">
              <td className="whitespace-nowrap px-5 py-3 text-fg-muted">
                <a href={`#/audit?event=${e.event_id}`} className="hover:text-fg">{formatTime(e.created_at)}</a>
              </td>
              <td className="py-3 capitalize text-fg">{e.scenario_id ? humanize(e.scenario_id) : <span className="text-fg-faint">Custom</span>}</td>
              <td className="py-3"><Mono>{e.request.tool_call.name}</Mono></td>
              <td className="py-3"><SeverityBadge severity={e.analysis.assessment?.severity} /></td>
              <td className="px-5 py-3"><DecisionBadge decision={e.policy.decision} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, icon, hint }: { label: string; value: number; icon: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-card border border-ink-700 bg-ink-900 p-5">
      <div className="flex items-center gap-2.5 text-[13px] font-medium text-fg-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink-600 text-fg-muted">{icon}</span>
        {label}
      </div>
      <div className="mt-4 text-[30px] font-semibold leading-none tracking-tight tabular text-fg">{value.toLocaleString()}</div>
      <div className="mt-2.5 min-h-[1rem] text-xs text-fg-faint">{hint}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-lg border border-ink-600 px-2.5 py-1 text-xs text-fg-muted">{children}</span>;
}

function Tracker({ rows, total, empty }: { rows: { key: string; label: string; n: number; color: string }[]; total: number; empty: string }) {
  if (!rows.length) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-fg">{r.label}</span>
            <span className="shrink-0 tabular text-fg-muted">{r.n} <span className="text-fg-faint">· {pct(r.n, total)}%</span></span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-800" role="img" aria-label={`${r.label}: ${r.n} of ${total}`}>
            <div className="h-1.5 rounded-full" style={{ width: `${Math.max(pct(r.n, total), 2)}%`, background: r.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const isTime = typeof label === "string" && label.includes("T");
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium capitalize text-fg">{isTime ? new Date(label).toLocaleString() : String(label)}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-fg-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.payload?.severity ? SEVERITY_COLORS[p.payload.severity] : p.color }} />
          {p.name}: <span className="tabular text-fg">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function DecisionSplit({ m }: { m: Metrics }) {
  const parts = [
    { key: "allow", label: "Allowed", n: m.allowed, color: C.allow },
    { key: "needs_approval", label: "Approval", n: m.needs_approval, color: C.needs_approval },
    { key: "block", label: "Blocked", n: m.blocked, color: C.block },
  ];
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-ink-800" role="img"
        aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {parts.filter((p) => p.n > 0).map((p) => (
          <div key={p.key} style={{ width: `${pct(p.n, total)}%`, background: p.color }} title={`${p.label}: ${p.n}`} />
        ))}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {parts.map((p) => (
          <div key={p.key} className={cx("flex items-center gap-1.5", p.n === 0 && "opacity-60")}>
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
            <dt className="text-fg-muted">{p.label}</dt>
            <dd className="tabular text-fg">{p.n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading metrics">
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[134px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-12"><Skeleton className="h-80 lg:col-span-7" /><Skeleton className="h-80 lg:col-span-5" /></div>
    </div>
  );
}
