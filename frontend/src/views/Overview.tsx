import { Activity, Ban, CheckCircle2, Inbox, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { Button, Card, DecisionBadge, PageHeader, EmptyState, ErrorState, Mono, SeverityBadge, Spinner, formatTime, humanize, useAsync } from "../components/ui";

// Reserved status colors (paired with labels/icons, never color alone).
const C = { allow: "#2fbf5b", needs_approval: "#fab219", block: "#e5484d", grid: "#232a32", axis: "#76808c" };
const SEVERITY_COLORS: Record<string, string> = {
  unassessed: "#4a535e", none: "#6b7480", low: "#8e98a4", medium: "#fab219", high: "#ec835a", critical: "#e5484d",
};
const SEVERITIES = ["unassessed", "none", "low", "medium", "high", "critical"];

export default function Overview() {
  const metrics = useAsync(() => api.metrics());
  const recent = useAsync(() => api.audit({ limit: 8 }));
  const refresh = () => { metrics.reload(); recent.reload(); };

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="All figures are computed from persisted audit events in SQLite."
        actions={<Button onClick={refresh}><RefreshCw size={14} /> Refresh</Button>} />

      {metrics.error && <ErrorState message={metrics.error} onRetry={refresh} />}
      {metrics.loading && !metrics.data && <Spinner />}

      {metrics.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Total requests" value={metrics.data.total_requests} icon={<Activity size={16} />} />
            <Stat label="Allowed" value={metrics.data.allowed} icon={<CheckCircle2 size={16} className="text-good" />}
              hint={`${metrics.data.executed} executed`} />
            <Stat label="Blocked" value={metrics.data.blocked} icon={<Ban size={16} className="text-[#ff6b70]" />}
              hint={metrics.data.needs_approval ? `+${metrics.data.needs_approval} awaiting approval` : undefined} />
            <Stat label="High-risk incidents" value={metrics.data.high_risk_incidents} icon={<ShieldAlert size={16} className="text-[#ec835a]" />}
              hint="Severity high or critical" />
            <Stat label="Model failures" value={metrics.data.model_failures} icon={<WifiOff size={16} className="text-warn" />}
              hint="Failed closed" />
          </div>

          {metrics.data.total_requests === 0 ? (
            <Card><EmptyState icon={<Inbox size={28} />} title="No activity recorded yet">
              Run a scenario from the <a className="text-accent underline" href="#/simulator">attack simulator</a> to generate real audit events.
            </EmptyState></Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Decisions over time" className="lg:col-span-2"
                actions={<span className="text-xs text-fg-faint">{metrics.data.timeline.bucket} buckets</span>}>
                <Legend items={[["Allowed", C.allow], ["Needs approval", C.needs_approval], ["Blocked", C.block]]} />
                <div className="h-60">
                  <ResponsiveContainer>
                    <BarChart data={metrics.data.timeline.points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="20%">
                      <CartesianGrid vertical={false} stroke={C.grid} />
                      <XAxis dataKey="bucket_start" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        tick={{ fill: C.axis, fontSize: 11 }} axisLine={{ stroke: C.grid }} tickLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="allow" name="Allowed" stackId="d" fill={C.allow} stroke="#0f1216" strokeWidth={1} />
                      <Bar dataKey="needs_approval" name="Needs approval" stackId="d" fill={C.needs_approval} stroke="#0f1216" strokeWidth={1} />
                      <Bar dataKey="block" name="Blocked" stackId="d" fill={C.block} stroke="#0f1216" strokeWidth={1} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Assessed severity">
                <div className="h-[268px]">
                  <ResponsiveContainer>
                    <BarChart layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                      data={SEVERITIES.map((s) => ({ severity: s, count: metrics.data!.by_severity[s] ?? 0 }))}>
                      <CartesianGrid horizontal={false} stroke={C.grid} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: C.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="severity" width={78} tick={{ fill: "#a3acb7", fontSize: 12 }} axisLine={false} tickLine={false}
                        tickFormatter={(s) => s[0].toUpperCase() + s.slice(1)} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                      <Bar dataKey="count" name="Events" radius={[0, 3, 3, 0]} barSize={14}
                        label={{ position: "right", fill: "#a3acb7", fontSize: 11 }}>
                        {SEVERITIES.map((s) => <Cell key={s} fill={SEVERITY_COLORS[s]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Blocking policies" className="lg:col-span-1">
                {Object.keys(metrics.data.by_matched_policy).length === 0 ? (
                  <p className="text-sm text-fg-muted">No policy has blocked an action yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {Object.entries(metrics.data.by_matched_policy).map(([p, n]) => {
                      const max = Math.max(...Object.values(metrics.data!.by_matched_policy));
                      return (
                        <li key={p} className="text-sm">
                          <div className="mb-1 flex justify-between"><Mono className="text-fg">{p}</Mono><span className="text-fg-muted">{n}</span></div>
                          <div className="h-1.5 rounded bg-ink-800"><div className="h-1.5 rounded bg-accent" style={{ width: `${(n / max) * 100}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card title="Recent audit events" className="lg:col-span-2"
                actions={<a href="#/audit" className="text-xs font-medium text-accent hover:underline">Open audit explorer</a>}>
                {recent.error && <ErrorState message={recent.error} />}
                {recent.data && <RecentTable items={recent.data.items} />}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecentTable({ items }: { items: import("../types").AuditEvent[] }) {
  return (
    <div className="scroll-thin -mx-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-fg-faint">
          <tr><th className="px-4 pb-2 font-semibold">Time</th><th className="pb-2 font-semibold">Scenario</th><th className="pb-2 font-semibold">Tool</th>
            <th className="pb-2 font-semibold">Severity</th><th className="px-4 pb-2 font-semibold">Decision</th></tr>
        </thead>
        <tbody className="divide-y divide-ink-700">
          {items.map((e) => (
            <tr key={e.event_id} className="hover:bg-ink-850">
              <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
                <a href={`#/audit?event=${e.event_id}`} className="hover:text-fg">{formatTime(e.created_at)}</a>
              </td>
              <td className="py-2 capitalize">{e.scenario_id ? humanize(e.scenario_id) : <span className="text-fg-faint">custom</span>}</td>
              <td className="py-2"><Mono>{e.request.tool_call.name}</Mono></td>
              <td className="py-2"><SeverityBadge severity={e.analysis.assessment?.severity} /></td>
              <td className="px-4 py-2"><DecisionBadge decision={e.policy.decision} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, icon, hint }: { label: string; value: number; icon: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between text-xs font-medium text-fg-muted">{label}{icon}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-fg">{value}</div>
      <div className="mt-1 h-4 text-xs text-fg-faint">{hint}</div>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-fg-muted">
      {items.map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const isTime = typeof label === "string" && label.includes("T");
  return (
    <div className="rounded-md border border-ink-600 bg-ink-850 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-fg">{isTime ? new Date(label).toLocaleString() : String(label)}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-fg-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.payload?.severity ? SEVERITY_COLORS[p.payload.severity] : p.color }} />
          {p.name}: <span className="font-mono text-fg">{p.value}</span>
        </div>
      ))}
    </div>
  );
}
