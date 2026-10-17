import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Crosshair, Database, LayoutDashboard, Radio, ScrollText, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { api } from "./api";
import type { Health } from "./types";
import { Skeleton, cx, usePolling } from "./components/ui";

// Each view is its own chunk; Recharts only loads with the Overview.
const Overview = lazy(() => import("./views/Overview"));
const Simulator = lazy(() => import("./views/Simulator"));
const Audit = lazy(() => import("./views/Audit"));
const Policies = lazy(() => import("./views/Policies"));

const VIEWS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "simulator", label: "Attack simulator", icon: Crosshair },
  { id: "audit", label: "Audit explorer", icon: ScrollText },
  { id: "policies", label: "Policies", icon: SlidersHorizontal },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

const HEALTH_POLL_MS = 30_000;

function currentView(): ViewId {
  const h = window.location.hash.replace("#/", "").split("?")[0];
  return (VIEWS.find((v) => v.id === h)?.id ?? "overview") as ViewId;
}

export default function App() {
  const [view, setView] = useState<ViewId>(currentView());
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setView(currentView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refreshHealth = useCallback((probe = false) =>
    api.health(probe)
      .then((h) => { setHealth(h); setHealthError(null); })
      .catch((e: Error) => setHealthError(e.message)), []);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);
  usePolling(() => refreshHealth(), HEALTH_POLL_MS);

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 md:flex-row md:gap-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-ink-800 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="shrink-0 p-3 md:sticky md:top-0 md:h-screen md:w-64 md:p-4 md:pr-0">
        <div className="flex h-full flex-col rounded-card border border-ink-700 bg-ink-900">
          <div className="flex items-center justify-between px-5 pb-3 pt-5 md:pb-6">
            <a href="#/overview" className="flex items-center gap-2.5" aria-label="ToolFence home">
              <ShieldCheck size={18} className="text-accent-soft" aria-hidden />
              <span className="text-[13px] font-semibold uppercase tracking-[0.42em] text-fg">Toolfence</span>
            </a>
          </div>
          <nav className="scroll-thin flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Main">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <a key={id} href={`#/${id}`} aria-current={view === id ? "page" : undefined}
                className={cx("flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  view === id ? "bg-accent text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset]" : "text-fg-muted hover:bg-ink-800 hover:text-fg")}>
                <Icon size={17} aria-hidden /> {label}
              </a>
            ))}
          </nav>
          <div className="mt-auto hidden p-3 md:block">
            <StatusCard health={health} error={healthError} onProbe={() => refreshHealth(true)} />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <HealthHeader health={health} error={healthError} />
        <main id="main" className="min-w-0 flex-1 px-4 pb-10 pt-2 md:px-8">
          <div className="mx-auto max-w-7xl">
            <Suspense fallback={<ViewSkeleton />}>
              {view === "overview" && <Overview />}
              {view === "simulator" && <Simulator health={health} />}
              {view === "audit" && <Audit />}
              {view === "policies" && <Policies />}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

function ViewSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );
}

type StatusTone = "good" | "warn" | "bad" | "faint";

function statuses(health: Health | null, error: string | null) {
  const m = health?.model;
  const probe = m?.last_probe;
  const backend: { tone: StatusTone; label: string; title?: string } = error ? { tone: "bad", label: "Backend unreachable", title: error }
    : !health ? { tone: "faint", label: "Checking backend…" }
    : health.database ? { tone: "good", label: "Backend online" }
    : { tone: "bad", label: "Database unavailable" };
  const model: { tone: StatusTone; label: string; title?: string } = error || !m ? { tone: "faint", label: "Model unknown" }
    : !m.configured ? { tone: "warn", label: "Model not configured", title: "Set GEMINI_API_KEY in backend/.env" }
    : !probe ? { tone: "faint", label: "Model not verified", title: "Configured; run a live test to verify the model ID" }
    : probe.ok ? { tone: "good", label: `Model live · ${probe.latency_ms} ms` }
    : { tone: "bad", label: "Model probe failed", title: probe.error };
  return { backend, model };
}

/** Compact health pill at the top of every page. */
function HealthHeader({ health, error }: { health: Health | null; error: string | null }) {
  const { backend, model } = statuses(health, error);
  return (
    <header className="flex justify-end px-4 pb-2 pt-1 md:px-8 md:pt-6" aria-label="System status">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-full border border-ink-700 bg-ink-900 px-4 py-1.5">
        <Status icon={<Database size={13} aria-hidden />} {...backend} />
        <span className="h-3 w-px bg-ink-700" aria-hidden />
        <Status icon={<Radio size={13} aria-hidden />} {...model} />
      </div>
      <span className="sr-only" aria-live="polite">{backend.label}. {model.label}.</span>
    </header>
  );
}

/** Sidebar card with model details and the live probe. */
function StatusCard({ health, error, onProbe }: { health: Health | null; error: string | null; onProbe: () => Promise<void> }) {
  const [probing, setProbing] = useState(false);
  const { model } = statuses(health, error);
  const m = health?.model;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3.5">
      <div className="text-xs text-fg-faint">Threat model</div>
      <div className="mt-1 truncate text-[13px] font-medium text-fg" title={m?.model_id}>{m?.model_id ?? "—"}</div>
      <div className="mt-2"><Status {...model} /></div>
      {m?.last_probe && !m.last_probe.ok && <p className="mt-2 line-clamp-3 break-words text-[11px] text-fg-faint" title={m.last_probe.error}>{m.last_probe.error}</p>}
      {m?.configured && !error && (
        <button disabled={probing} onClick={() => { setProbing(true); onProbe().finally(() => setProbing(false)); }}
          className="mt-3 w-full rounded-lg border border-ink-600 py-1.5 text-xs font-medium text-fg hover:bg-ink-800 disabled:text-fg-faint">
          {probing ? "Testing model…" : "Test live model"}
        </button>
      )}
    </div>
  );
}

function Status({ icon, tone, label, title }: { icon?: React.ReactNode; tone: StatusTone; label: string; title?: string }) {
  const c = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", faint: "bg-fg-faint" }[tone];
  return (
    <span className="flex items-center gap-2 whitespace-nowrap text-xs text-fg-muted" title={title}>
      {icon && <span className="text-fg-faint">{icon}</span>}
      <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", c)} aria-hidden />
      {label}
    </span>
  );
}
