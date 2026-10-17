import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(() => {
    setLoading(true);
    return load()
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function Card({ title, icon, actions, children, className }: {
  title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-ink-700 bg-ink-900", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            {icon && <span className="text-fg-muted">{icon}</span>}
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", icon, children, title }: {
  tone?: "neutral" | "good" | "warn" | "bad" | "accent" | "serious"; icon?: ReactNode; children: ReactNode; title?: string;
}) {
  const tones = {
    neutral: "border-ink-600 bg-ink-800 text-fg-muted",
    good: "border-good/40 bg-good/10 text-good",
    warn: "border-warn/40 bg-warn/10 text-warn",
    serious: "border-[#ec835a]/40 bg-[#ec835a]/10 text-[#ec835a]",
    bad: "border-bad/40 bg-bad/10 text-[#ff6b70]",
    accent: "border-accent/40 bg-accent/10 text-accent",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium", tones[tone])}>
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

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-bad/40 bg-bad/10 p-3 text-sm text-[#ffb3b5]" role="alert">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium underline underline-offset-2">Retry</button>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="text-fg-faint">{icon}</div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="max-w-sm text-sm text-fg-muted">{children}</div>}
    </div>
  );
}

export function Button({ variant = "secondary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const v = {
    primary: "bg-accent text-ink-950 hover:bg-[#7aaff5] disabled:bg-ink-700 disabled:text-fg-faint",
    secondary: "border border-ink-600 bg-ink-800 text-fg hover:bg-ink-700 disabled:text-fg-faint",
    ghost: "text-fg-muted hover:bg-ink-800 hover:text-fg",
  }[variant];
  return <button {...props} className={cx("inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed", v, className)} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{children}</div>;
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
