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
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-ink-800 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="flex shrink-0 flex-col border-b border-ink-700 bg-ink-900 md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-5 py-4">
          <ShieldCheck size={22} className="text-accent" aria-hidden />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">ToolFence</div>
            <div className="text-[11px] text-fg-faint">Agent runtime gateway</div>
          </div>
        </div>
        <nav className="scroll-thin flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Main">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#/${id}`} aria-current={view === id ? "page" : undefined}
              className={cx("flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                view === id ? "bg-ink-800 text-fg" : "text-fg-muted hover:bg-ink-850 hover:text-fg")}>
              <Icon size={16} aria-hidden /> {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <HealthHeader health={health} error={healthError} onProbe={() => refreshHealth(true)} />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8">
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

function HealthHeader({ health, error, onProbe }: { health: Health | null; error: string | null; onProbe: () => Promise<void> }) {
  const [probing, setProbing] = useState(false);
  const m = health?.model;
  const probe = m?.last_probe;

  const backend = error ? { tone: "bad" as const, label: "Backend unreachable", title: error }
    : !health ? { tone: "faint" as const, label: "Checking backend…" }
    : health.database ? { tone: "good" as const, label: "Backend online" }
    : { tone: "bad" as const, label: "Database unavailable" };

  const model = error || !m ? { tone: "faint" as const, label: "Model unknown" }
    : !m.configured ? { tone: "warn" as const, label: "Model not configured", title: "Set GEMINI_API_KEY in backend/.env" }
    : !probe ? { tone: "faint" as const, label: "Model not verified", title: "Configured; run a live test to verify the model ID" }
    : probe.ok ? { tone: "good" as const, label: `Model live · ${probe.latency_ms} ms` }
    : { tone: "bad" as const, label: "Model probe failed", title: probe.error };

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink-700 bg-ink-950/90 px-4 py-2.5 backdrop-blur md:px-8"
      aria-label="System status">
      <Status icon={<Database size={14} aria-hidden />} {...backend} />
      <Status icon={<Radio size={14} aria-hidden />} {...model} />
      {m && <code className="hidden truncate font-mono text-[12px] text-fg-faint sm:inline" title="GEMMA_MODEL">{m.model_id}</code>}
      {m?.configured && !error && (
        <button disabled={probing} onClick={() => { setProbing(true); onProbe().finally(() => setProbing(false)); }}
          className="ml-auto rounded-md border border-ink-600 px-2.5 py-1 text-xs font-medium text-accent hover:bg-ink-800 disabled:text-fg-faint">
          {probing ? "Testing model…" : "Test live model"}
        </button>
      )}
      <span className="sr-only" aria-live="polite">{backend.label}. {model.label}.</span>
    </header>
  );
}

function Status({ icon, tone, label, title }: { icon: React.ReactNode; tone: "good" | "warn" | "bad" | "faint"; label: string; title?: string }) {
  const c = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", faint: "bg-fg-faint" }[tone];
  return (
    <span className="flex items-center gap-2 text-xs text-fg-muted" title={title}>
      <span className="text-fg-faint">{icon}</span>
      <span className={cx("h-2 w-2 shrink-0 rounded-full", c)} aria-hidden />
      {label}
    </span>
  );
}
