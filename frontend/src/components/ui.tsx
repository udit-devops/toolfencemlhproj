import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, FlaskConical, Hand, Loader2, Radio, ShieldAlert, WifiOff,
} from "lucide-react";
import type { AnalysisResult, Decision, Severity } from "../types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const latest = useRef(0);
  const reload = useCallback(() => {
    const id = ++latest.current; // ignore responses that arrive after a newer request
    setLoading(true);
    return load()
      .then((d) => { if (id === latest.current) { setData(d); setError(null); setUpdatedAt(new Date()); } })
      .catch((e: Error) => { if (id === latest.current) setError(e.message); })
      .finally(() => { if (id === latest.current) setLoading(false); });
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData, updatedAt };
}

/** Calls `cb` every `ms` while enabled and the tab is visible; refreshes once when the tab returns. */
export function usePolling(cb: () => unknown, ms: number, enabled = true) {
  const [hidden, setHidden] = useState(() => document.hidden);
  const saved = useRef(cb);
  saved.current = cb;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.hidden);
      if (!document.hidden && enabledRef.current) saved.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!enabled || hidden) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled, hidden]);
  return { paused: hidden || !enabled, hidden };
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-card bg-ink-900", className)} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, icon, actions, children, className, bodyClassName }: {
  title?: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cx("min-w-0 rounded-card border border-ink-700 bg-ink-900", className)}>
      {title && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              {icon && <span className="text-fg-muted">{icon}</span>}
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-[13px] text-fg-muted">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", icon, children, title }: {
  tone?: "neutral" | "good" | "warn" | "bad" | "accent" | "serious"; icon?: ReactNode; children: ReactNode; title?: string;
}) {
  const tones = {
    neutral: "bg-ink-800 text-fg-muted",
    good: "bg-good/[0.12] text-good",
    warn: "bg-warn/[0.12] text-warn",
    serious: "bg-serious/[0.12] text-serious",
    bad: "bg-bad/[0.14] text-bad-fg",
    accent: "bg-accent/[0.16] text-accent-soft",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {icon}
      {children}
    </span>
  );
}

export const DECISION_LABEL: Record<Decision, string> = { allow: "Allowed", block: "Blocked", needs_approval: "Needs approval" };

export function DecisionBadge({ decision, large }: { decision: Decision; large?: boolean }) {
  const s = large ? 16 : 12;
  if (decision === "allow") return <Badge tone="good" icon={<CheckCircle2 size={s} />}>{DECISION_LABEL.allow}</Badge>;
  if (decision === "block") return <Badge tone="bad" icon={<Ban size={s} />}>{DECISION_LABEL.block}</Badge>;
  return <Badge tone="warn" icon={<Hand size={s} />}>{DECISION_LABEL.needs_approval}</Badge>;
}

export function SeverityBadge({ severity }: { severity: Severity | null | undefined }) {
  if (!severity) return <Badge icon={<CircleDashed size={12} />}>Unassessed</Badge>;
  const tone = { none: "neutral", low: "neutral", medium: "warn", high: "serious", critical: "bad" }[severity] as
    "neutral" | "warn" | "serious" | "bad";
  return <Badge tone={tone} icon={severity === "high" || severity === "critical" ? <ShieldAlert size={12} /> : undefined}>
    {severity[0].toUpperCase() + severity.slice(1)}
  </Badge>;
}

export function SourceBadge({ analysis }: { analysis: AnalysisResult }) {
  if (analysis.source === "test_fixture")
    return <Badge tone="accent" icon={<FlaskConical size={12} />} title="Deterministic test fixture — no model was called">Test fixture</Badge>;
  if (analysis.status === "ok")
    return <Badge tone="good" icon={<Radio size={12} />} title={`Live response from ${analysis.model}`}>Live Gemma</Badge>;
  return <Badge tone="warn" icon={<WifiOff size={12} />} title={analysis.error ?? ""}>
    Model {analysis.status.replace("_", " ")}
  </Badge>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted" role="status">
      <Loader2 size={16} className="animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorState({ message, onRetry, retryLabel = "Retry" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/[0.08] p-3.5 text-sm text-bad-soft" role="alert">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded-lg border border-bad/40 px-2.5 py-1 text-xs font-medium hover:bg-bad/20">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-xl border border-ink-700 bg-ink-850 text-fg-faint">{icon}</div>
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {children && <div className="max-w-sm text-sm text-fg-muted">{children}</div>}
    </div>
  );
}

export function Button({ variant = "secondary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const v = {
    primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-ink-700 disabled:text-fg-faint",
    secondary: "border border-ink-600 bg-transparent text-fg hover:bg-ink-800 disabled:text-fg-faint",
    ghost: "text-fg-muted hover:bg-ink-800 hover:text-fg",
  }[variant];
  return <button {...props} className={cx("inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed", v, className)} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[13px] font-medium text-fg-muted">{children}</div>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cx("font-mono text-[12px] text-fg-muted", className)}>{children}</code>;
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function humanize(id: string | null | undefined) {
  return id ? id.replace(/_/g, " ") : "—";
}
