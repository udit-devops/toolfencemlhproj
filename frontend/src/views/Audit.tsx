import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Inbox, RefreshCw, Search } from "lucide-react";
import { api } from "../api";
import type { AuditEvent } from "../types";
import { EventPanels } from "../components/EventPanels";
import { Button, Card, DecisionBadge, EmptyState, ErrorState, Mono, SeverityBadge, SourceBadge, Spinner, cx, formatTime, humanize, useAsync, PageHeader } from "../components/ui";

const PAGE = 25;

function linkedEvent() {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("event");
}

export default function Audit() {
  const [decision, setDecision] = useState("");
  const [severity, setSeverity] = useState("");
  const [scenario, setScenario] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(linkedEvent());

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setOffset(0); }, [decision, severity, scenario, query]);

  const scenarios = useAsync(() => api.scenarios());
  const events = useAsync(() => api.audit({ decision, severity, scenario, q: query, limit: PAGE, offset }),
    [decision, severity, scenario, query, offset]);
  const linked = useAsync(() => (open ? api.event(open).catch(() => null) : Promise.resolve(null)), []);

  const items = events.data?.items ?? [];
  const extra = linked.data && !items.some((e) => e.event_id === linked.data!.event_id) ? [linked.data] : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Audit explorer" subtitle="Every gateway decision, persisted with its full evidence."
        actions={<Button onClick={events.reload}><RefreshCw size={14} /> Refresh</Button>} />

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search event ID, tool, content…" maxLength={100}
            aria-label="Search audit events"
            className="w-full rounded-md border border-ink-600 bg-ink-900 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent" />
        </div>
        <Select label="Decision" value={decision} onChange={setDecision}
          options={[["", "All decisions"], ["allow", "Allowed"], ["block", "Blocked"], ["needs_approval", "Needs approval"]]} />
        <Select label="Risk" value={severity} onChange={setSeverity}
          options={[["", "All risk levels"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["none", "None"], ["unassessed", "Unassessed"]]} />
        <Select label="Scenario" value={scenario} onChange={setScenario}
          options={[["", "All scenarios"], ...(scenarios.data ?? []).map((s) => [s.id, `${s.label} · ${s.title}`] as [string, string]), ["custom", "Custom (no scenario)"]]} />
      </div>

      <Card>
        {events.error && <ErrorState message={events.error} onRetry={events.reload} />}
        {events.loading && !events.data && <Spinner />}
        {events.data && items.length + extra.length === 0 && (
          <EmptyState icon={<Inbox size={28} />} title="No matching events">
            {decision || severity || scenario || query ? "Try clearing the filters." : <>Run a scenario in the <a href="#/simulator" className="text-accent underline">simulator</a>.</>}
          </EmptyState>
        )}
        {[...extra, ...items].length > 0 && (
          <ul className="-m-4 divide-y divide-ink-700">
            {[...extra, ...items].map((e) => (
              <Row key={e.event_id} event={e} open={open === e.event_id} onToggle={() => setOpen(open === e.event_id ? null : e.event_id)} />
            ))}
          </ul>
        )}
      </Card>

      {events.data && events.data.total > PAGE && (
        <div className="flex items-center justify-between text-sm text-fg-muted">
          <span>{offset + 1}–{Math.min(offset + PAGE, events.data.total)} of {events.data.total}</span>
          <div className="flex gap-2">
            <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
            <Button disabled={offset + PAGE >= events.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ event: e, open, onToggle }: { event: AuditEvent; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button onClick={onToggle} aria-expanded={open}
        className={cx("grid w-full grid-cols-[16px_1fr_auto] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-ink-850", open && "bg-ink-850")}>
        {open ? <ChevronDown size={16} className="text-fg-faint" /> : <ChevronRight size={16} className="text-fg-faint" />}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="whitespace-nowrap text-fg-muted">{formatTime(e.created_at)}</span>
          <Mono className="text-fg">{e.request.tool_call.name}</Mono>
          <span className="capitalize text-fg-muted">{e.scenario_id ? humanize(e.scenario_id) : "custom"}</span>
          <Mono className="hidden text-fg-faint lg:inline">{e.event_id}</Mono>
        </div>
        <div className="flex items-center gap-2">
          <SourceBadge analysis={e.analysis} />
          <SeverityBadge severity={e.analysis.assessment?.severity} />
          <DecisionBadge decision={e.policy.decision} />
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-ink-700 bg-ink-950/40 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-fg-muted">
            <span className="flex items-center gap-1.5">Event ID <Mono className="text-fg">{e.event_id}</Mono>
              <button onClick={() => navigator.clipboard?.writeText(e.event_id)} title="Copy event ID" className="text-fg-faint hover:text-fg"><Copy size={12} /></button>
            </span>
            <span>Recorded {new Date(e.created_at).toISOString()}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Task</div><p className="text-sm">{e.request.task}</p></div>
            <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Untrusted document</div>
              <pre className="scroll-thin max-h-32 overflow-auto whitespace-pre-wrap rounded border border-ink-700 bg-ink-950 p-2 font-mono text-[12px] text-fg-muted">{e.request.document || "(empty)"}</pre></div>
          </div>
          <EventPanels event={e} />
        </div>
      )}
    </li>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
