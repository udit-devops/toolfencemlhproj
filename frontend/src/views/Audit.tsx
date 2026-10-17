import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Copy, Inbox, RefreshCw, Search, X } from "lucide-react";
import { api } from "../api";
import type { AuditEvent } from "../types";
import { EventPanels } from "../components/EventPanels";
import { Button, Card, DecisionBadge, EmptyState, ErrorState, Mono, SeverityBadge, Skeleton, SourceBadge, formatTime, humanize, useAsync, PageHeader } from "../components/ui";

const PAGE = 25;
const FILTER_KEYS = ["decision", "severity", "scenario", "q"] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

function readHashParams() {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "");
}

/** Mirror filters, page and open event into the hash so views are shareable and survive reloads. */
function writeHashParams(filters: Filters, offset: number, event: string | null) {
  const p = new URLSearchParams();
  FILTER_KEYS.forEach((k) => filters[k] && p.set(k, filters[k]));
  if (offset) p.set("offset", String(offset));
  if (event) p.set("event", event);
  const qs = p.toString();
  window.history.replaceState(null, "", `#/audit${qs ? `?${qs}` : ""}`);
}

export default function Audit() {
  const initial = readHashParams();
  const [filters, setFilters] = useState<Filters>({
    decision: initial.get("decision") ?? "", severity: initial.get("severity") ?? "",
    scenario: initial.get("scenario") ?? "", q: initial.get("q") ?? "",
  });
  const [qDraft, setQDraft] = useState(filters.q);
  const [offset, setOffset] = useState(Number(initial.get("offset")) || 0);
  const [open, setOpen] = useState<string | null>(initial.get("event"));
  const opener = useRef<HTMLElement | null>(null);

  const setFilter = (k: keyof Filters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setOffset(0); };
  useEffect(() => {
    const t = setTimeout(() => { if (qDraft.trim() !== filters.q) setFilter("q", qDraft.trim()); }, 300);
    return () => clearTimeout(t);
  }, [qDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { writeHashParams(filters, offset, open); }, [filters, offset, open]);

  const scenarios = useAsync(() => api.scenarios());
  const events = useAsync(() => api.audit({ ...filters, limit: PAGE, offset }), [filters, offset]);
  const filtered = FILTER_KEYS.some((k) => filters[k]);
  const items = events.data?.items ?? [];

  const close = useCallback(() => { setOpen(null); opener.current?.focus(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Audit explorer" subtitle="Every gateway decision, persisted with its full evidence."
        actions={<Button onClick={events.reload} disabled={events.loading}><RefreshCw size={14} className={events.loading ? "animate-spin" : ""} /> Refresh</Button>} />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-0 sm:min-w-[220px] sm:flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" aria-hidden />
          <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Search event ID, tool, content…" maxLength={100}
            aria-label="Search audit events" type="search"
            className="w-full rounded-md border border-ink-600 bg-ink-900 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent" />
        </div>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 sm:flex">
          <Select label="Decision" value={filters.decision} onChange={(v) => setFilter("decision", v)}
            options={[["", "All decisions"], ["allow", "Allowed"], ["block", "Blocked"], ["needs_approval", "Needs approval"]]} />
          <Select label="Risk" value={filters.severity} onChange={(v) => setFilter("severity", v)}
            options={[["", "All risk levels"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["low", "Low"], ["none", "None"], ["unassessed", "Unassessed"]]} />
          <Select label="Scenario" value={filters.scenario} onChange={(v) => setFilter("scenario", v)}
            options={[["", "All scenarios"], ...(scenarios.data ?? []).map((s) => [s.id, `${s.label} · ${s.title}`] as [string, string]), ["custom", "Custom (no scenario)"]]} />
        </div>
        {filtered && <Button variant="ghost" onClick={() => { setFilters({ decision: "", severity: "", scenario: "", q: "" }); setQDraft(""); setOffset(0); }}>Clear filters</Button>}
      </div>

      <Card>
        {events.error && <ErrorState message={events.error} onRetry={events.reload} />}
        {events.loading && !events.data && !events.error && (
          <div className="space-y-3" aria-busy aria-label="Loading audit events">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        )}
        {events.data && items.length === 0 && (
          <EmptyState icon={<Inbox size={28} />} title={filtered ? "No events match these filters" : "No audit events yet"}>
            {filtered ? "Try clearing or loosening the filters." : <>Run a scenario in the <a href="#/simulator" className="text-accent underline">attack simulator</a> to record the first event.</>}
          </EmptyState>
        )}
        {items.length > 0 && (
          <ul className="-m-4 divide-y divide-ink-700">
            {items.map((e) => (
              <Row key={e.event_id} event={e} active={open === e.event_id}
                onOpen={(el) => { opener.current = el; setOpen(e.event_id); }} />
            ))}
          </ul>
        )}
      </Card>

      {events.data && events.data.total > 0 && (
        <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted" aria-label="Pagination">
          <span>{Math.min(offset + 1, events.data.total)}–{Math.min(offset + PAGE, events.data.total)} of {events.data.total}</span>
          <div className="flex gap-2">
            <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
            <Button disabled={offset + PAGE >= events.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
          </div>
        </nav>
      )}

      {open && <EventDrawer eventId={open} onClose={close} />}
    </div>
  );
}

function Row({ event: e, active, onOpen }: { event: AuditEvent; active: boolean; onOpen: (el: HTMLElement) => void }) {
  return (
    <li>
      <button onClick={(ev) => onOpen(ev.currentTarget)} aria-haspopup="dialog"
        className={`flex w-full flex-col gap-2 px-4 py-3 text-left text-sm hover:bg-ink-850 md:flex-row md:items-center md:gap-3 ${active ? "bg-ink-850" : ""}`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="whitespace-nowrap text-fg-muted">{formatTime(e.created_at)}</span>
          <Mono className="text-fg">{e.request.tool_call.name}</Mono>
          <span className="capitalize text-fg-muted">{e.scenario_id ? humanize(e.scenario_id) : "custom"}</span>
          <Mono className="hidden text-fg-faint lg:inline">{e.event_id}</Mono>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge analysis={e.analysis} />
          <SeverityBadge severity={e.analysis.assessment?.severity} />
          <DecisionBadge decision={e.policy.decision} />
          <ChevronRight size={16} className="hidden text-fg-faint md:block" aria-hidden />
        </div>
      </button>
    </li>
  );
}

function EventDrawer({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const detail = useAsync(() => api.event(eventId), [eventId]);
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeBtn.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const focusable = panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const e = detail.data;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="drawer-title"
        className="scroll-thin relative flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-ink-700 bg-ink-900 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink-700 bg-ink-900 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-sm font-semibold">Audit event</h2>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Mono className="truncate">{eventId}</Mono>
              <button onClick={() => navigator.clipboard?.writeText(eventId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
                className="text-fg-faint hover:text-fg" aria-label="Copy event ID"><Copy size={12} /></button>
              {copied && <span className="text-[11px] text-good" role="status">Copied</span>}
            </div>
          </div>
          <button ref={closeBtn} onClick={onClose} aria-label="Close event details" className="rounded p-1 text-fg-muted hover:bg-ink-800 hover:text-fg"><X size={18} /></button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {detail.error && <ErrorState message={detail.error} onRetry={detail.reload} />}
          {detail.loading && !e && !detail.error && (
            <div className="space-y-3" aria-busy aria-label="Loading event">
              <Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-56" /><Skeleton className="h-40" />
            </div>
          )}
          {e && (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-muted">
                <DecisionBadge decision={e.policy.decision} />
                <span>Recorded <time dateTime={e.created_at}>{new Date(e.created_at).toLocaleString()}</time></span>
                <span className="capitalize">Scenario: {e.scenario_id ? humanize(e.scenario_id) : "custom"}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Task</div><p className="text-sm">{e.request.task}</p></div>
                <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Untrusted document</div>
                  <pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-ink-700 bg-ink-950 p-2 font-mono text-[12px] text-fg-muted">{e.request.document || "(empty)"}</pre></div>
              </div>
              <EventPanels event={e} stacked />
              {e.analysis.raw_response_excerpt && (
                <details className="rounded-md border border-ink-700 bg-ink-850 p-3 text-sm">
                  <summary className="cursor-pointer text-fg-muted">Raw model response (excerpt)</summary>
                  <pre className="scroll-thin mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-fg-muted">{e.analysis.raw_response_excerpt}</pre>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent sm:w-auto">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
