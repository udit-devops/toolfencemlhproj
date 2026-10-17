import {
  ArrowRight, Ban, Brain, Check, CheckCircle2, CircleSlash, Gavel, Hand, MinusCircle, Play, Quote, Terminal, X,
} from "lucide-react";
import type { AuditEvent, CheckOutcome } from "../types";
import { Badge, Card, DecisionBadge, Label, Mono, SeverityBadge, SourceBadge, cx, humanize } from "./ui";

export function ThreatPanel({ event }: { event: AuditEvent }) {
  const { analysis } = event;
  const a = analysis.assessment;
  return (
    <Card
      title="1 · Threat assessment"
      icon={<Brain size={16} />}
      actions={<SourceBadge analysis={analysis} />}
    >
      <p className="mb-3 text-xs text-fg-faint">
        Advisory only. Model output is untrusted input and can tighten — never grant — permissions.
      </p>
      {a ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Severity"><SeverityBadge severity={a.severity} /></Field>
            <Field label="Category"><span className="text-sm capitalize">{humanize(a.risk_category)}</span></Field>
            <Field label="Confidence"><span className="font-mono text-sm">{Math.round(a.confidence * 100)}%</span></Field>
            <Field label="Task alignment"><span className="text-sm capitalize">{a.task_alignment}</span></Field>
          </div>
          <Field label="Explanation"><p className="text-sm leading-relaxed text-fg">{a.explanation}</p></Field>
          <Field label="Suspicious excerpts">
            {a.suspicious_excerpts.length === 0 ? (
              <span className="text-sm text-fg-faint">None reported</span>
            ) : (
              <ul className="space-y-1.5">
                {a.suspicious_excerpts.map((ex, i) => (
                  <li key={i} className="flex gap-2 rounded border border-ink-700 bg-ink-850 p-2 text-sm">
                    <Quote size={14} className="mt-0.5 shrink-0 text-fg-faint" />
                    <span className="flex-1 font-mono text-[12px] text-[#f2c9a5]">{ex}</span>
                    {analysis.excerpts_verified[i] === false && (
                      <Badge title="This excerpt does not appear verbatim in the document">Not verbatim</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </div>
      ) : (
        <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-sm">
          <p className="font-medium text-warn">No usable analysis ({humanize(analysis.status)})</p>
          {analysis.error && <p className="mt-1 break-words font-mono text-[12px] text-fg-muted">{analysis.error}</p>}
          <p className="mt-2 text-fg-muted">Protected actions fail closed. Read-only tools may proceed if policy allows.</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-700 pt-3 text-xs text-fg-faint">
        <span>Source: <span className="text-fg-muted">{analysis.source === "test_fixture" ? "test fixture (no model call)" : analysis.source === "live_model" ? "live model" : "none"}</span></span>
        {analysis.model && <span>Model: <Mono>{analysis.model}</Mono></span>}
        {analysis.latency_ms !== null && <span>Latency: <span className="text-fg-muted">{analysis.latency_ms} ms</span></span>}
      </div>
    </Card>
  );
}

const OUTCOME: Record<CheckOutcome, { icon: JSX.Element; cls: string; label: string }> = {
  pass: { icon: <Check size={14} />, cls: "text-good", label: "Pass" },
  fail: { icon: <X size={14} />, cls: "text-bad-fg", label: "Fail" },
  approval_required: { icon: <Hand size={14} />, cls: "text-warn", label: "Approval" },
  not_applicable: { icon: <MinusCircle size={14} />, cls: "text-fg-faint", label: "N/A" },
  skipped: { icon: <CircleSlash size={14} />, cls: "text-fg-faint", label: "Skipped" },
  disabled: { icon: <CircleSlash size={14} />, cls: "text-fg-faint", label: "Disabled" },
};

export function EnforcementPanel({ event }: { event: AuditEvent }) {
  const { policy, model_vs_policy: mvp } = event;
  return (
    <Card title="2 · Policy decision" icon={<Gavel size={16} />} actions={<DecisionBadge decision={policy.decision} />}>
      <p className="mb-3 text-xs text-fg-faint">Deterministic. Evaluated by the gateway, independent of the model's recommendation.</p>
      <div className={cx("mb-4 rounded-md border p-3 text-sm",
        policy.decision === "allow" ? "border-good/30 bg-good/5" : policy.decision === "block" ? "border-bad/30 bg-bad/5" : "border-warn/30 bg-warn/5")}>
        <div className="text-fg">{policy.reason}</div>
        {policy.matched_policy && <div className="mt-1 text-xs text-fg-muted">Matched policy: <Mono>{policy.matched_policy}</Mono></div>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ink-700 bg-ink-850 p-3 text-sm">
        <span className="text-fg-muted">Model recommended</span>
        <span className="font-semibold capitalize">{mvp.model_recommendation ?? "n/a"}</span>
        <ArrowRight size={14} className="text-fg-faint" />
        <span className="text-fg-muted">Policy decided</span>
        <DecisionBadge decision={mvp.policy_decision} />
        {mvp.agreement === false && <Badge tone="accent">Policy overrode model</Badge>}
        {mvp.agreement === true && <Badge>Agreement</Badge>}
      </div>

      <Label>Checks (in evaluation order)</Label>
      <ol className="divide-y divide-ink-700 rounded-md border border-ink-700">
        {policy.checks.map((c) => {
          const o = OUTCOME[c.outcome];
          return (
            <li key={c.policy_id} className={cx("flex gap-3 px-3 py-2 text-sm", c.policy_id === policy.matched_policy && "bg-ink-800")}>
              <span className={cx("mt-0.5 flex w-20 shrink-0 items-center gap-1 text-xs font-semibold", o.cls)}>{o.icon}{o.label}</span>
              <div className="min-w-0">
                <div className="font-medium text-fg">{c.policy_name}</div>
                <div className="break-words text-xs text-fg-muted">{c.detail}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function ExecutionPanel({ event }: { event: AuditEvent }) {
  const { execution, request } = event;
  const executed = execution.status === "executed";
  return (
    <Card
      title="3 · Execution"
      icon={<Terminal size={16} />}
      actions={executed ? <Badge tone="good" icon={<Play size={12} />}>Executed</Badge>
        : execution.status === "failed" ? <Badge tone="bad">Failed</Badge>
        : <Badge icon={<Ban size={12} />}>Not executed</Badge>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Proposed tool">
          <div className="flex items-center gap-2">
            <Mono className="text-fg">{request.tool_call.name}</Mono>
            {event.tool_sensitivity ? <Badge tone={event.tool_sensitivity === "read_only" ? "neutral" : "warn"}>{humanize(event.tool_sensitivity)}</Badge>
              : <Badge tone="bad">unregistered</Badge>}
          </div>
        </Field>
        <Field label="Human approval supplied">
          <span className="text-sm">{request.human_approval ? "Yes" : "No"}</span>
        </Field>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Field label="Arguments">
          <pre className="scroll-thin max-h-48 overflow-auto rounded border border-ink-700 bg-ink-950 p-2 font-mono text-[12px] text-fg-muted">
            {JSON.stringify(request.tool_call.arguments, null, 2)}
          </pre>
        </Field>
        <Field label={executed ? "Tool output (synthetic)" : "Tool output"}>
          {executed ? (
            <pre className="scroll-thin max-h-48 overflow-auto rounded border border-good/30 bg-ink-950 p-2 font-mono text-[12px] text-good">
              {JSON.stringify(execution.output, null, 2)}
            </pre>
          ) : (
            <div className="flex h-full min-h-[3rem] items-center gap-2 rounded border border-dashed border-ink-600 p-2 text-sm text-fg-muted">
              {execution.status === "failed" ? execution.error : <><CheckCircle2 size={14} className="text-fg-faint" /> The protected function was never invoked.</>}
            </div>
          )}
        </Field>
      </div>
    </Card>
  );
}

export function EventPanels({ event, stacked }: { event: AuditEvent; stacked?: boolean }) {
  return (
    <div className={cx("grid gap-4", !stacked && "lg:grid-cols-2")}>
      <ThreatPanel event={event} />
      <EnforcementPanel event={event} />
      <div className={cx(!stacked && "lg:col-span-2")}><ExecutionPanel event={event} /></div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label>{children}</div>;
}
