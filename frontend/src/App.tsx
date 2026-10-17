import { useEffect, useState } from "react";
import { Crosshair, LayoutDashboard, ScrollText, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { api } from "./api";
import type { Health } from "./types";
import { cx } from "./components/ui";
import Overview from "./views/Overview";
import Simulator from "./views/Simulator";
import Audit from "./views/Audit";
import Policies from "./views/Policies";

const VIEWS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "simulator", label: "Attack simulator", icon: Crosshair },
  { id: "audit", label: "Audit explorer", icon: ScrollText },
  { id: "policies", label: "Policies", icon: SlidersHorizontal },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

function currentView(): ViewId {
  const h = window.location.hash.replace("#/", "").split("?")[0];
  return (VIEWS.find((v) => v.id === h)?.id ?? "overview") as ViewId;
}

export default function App() {
  const [view, setView] = useState<ViewId>(currentView());
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    const onHash = () => setView(currentView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refreshHealth = (probe = false) =>
    api.health(probe).then((h) => { setHealth(h); setHealthError(false); }).catch(() => setHealthError(true));
  useEffect(() => { refreshHealth(); }, []);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-ink-700 bg-ink-900 md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-5 py-4">
          <ShieldCheck size={22} className="text-accent" />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">ToolFence</div>
            <div className="text-[11px] text-fg-faint">Agent runtime gateway</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Main">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#/${id}`} aria-current={view === id ? "page" : undefined}
              className={cx("flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                view === id ? "bg-ink-800 text-fg" : "text-fg-muted hover:bg-ink-850 hover:text-fg")}>
              <Icon size={16} /> {label}
            </a>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-ink-700 p-4 text-xs md:block">
          <ModelStatus health={health} error={healthError} onProbe={() => refreshHealth(true)} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 md:hidden"><ModelStatus health={health} error={healthError} onProbe={() => refreshHealth(true)} /></div>
          {view === "overview" && <Overview />}
          {view === "simulator" && <Simulator health={health} />}
          {view === "audit" && <Audit />}
          {view === "policies" && <Policies />}
        </div>
      </main>
    </div>
  );
}

function ModelStatus({ health, error, onProbe }: { health: Health | null; error: boolean; onProbe: () => Promise<void> }) {
  const [probing, setProbing] = useState(false);
  if (error) return <Dot tone="bad" label="Backend unreachable" />;
  if (!health) return <Dot tone="faint" label="Checking backend…" />;
  const m = health.model;
  const probe = m.last_probe;
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Threat model</div>
      <div className="break-all font-mono text-[12px] text-fg-muted">{m.model_id}</div>
      {!m.configured ? <Dot tone="warn" label="API key not configured" />
        : !probe ? <Dot tone="faint" label="Configured · not yet verified" />
        : probe.ok ? <Dot tone="good" label={`Verified live · ${probe.latency_ms} ms`} />
        : <Dot tone="bad" label="Probe failed" title={probe.error} />}
      {probe && !probe.ok && <p className="line-clamp-4 break-words text-[11px] text-fg-faint" title={probe.error}>{probe.error}</p>}
      {m.configured && (
        <button disabled={probing} onClick={() => { setProbing(true); onProbe().finally(() => setProbing(false)); }}
          className="text-[12px] font-medium text-accent hover:underline disabled:text-fg-faint">
          {probing ? "Testing model…" : "Test live model"}
        </button>
      )}
    </div>
  );
}

function Dot({ tone, label, title }: { tone: "good" | "warn" | "bad" | "faint"; label: string; title?: string }) {
  const c = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", faint: "bg-fg-faint" }[tone];
  return <div className="flex items-center gap-2 text-[12px] text-fg-muted" title={title}><span className={cx("h-2 w-2 rounded-full", c)} />{label}</div>;
}
