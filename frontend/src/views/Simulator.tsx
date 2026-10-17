import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Crosshair, FlaskConical, Hand, Inbox, PenLine, Play, RotateCcw } from "lucide-react";
import { api } from "../api";
import type { AuditEvent, Health, JsonSchema, Scenario, ToolInfo } from "../types";
import { EventPanels } from "../components/EventPanels";
import { Badge, Button, Card, DECISION_LABEL, EmptyState, ErrorState, Label, Mono, Skeleton, Spinner, cx, humanize, useAsync, PageHeader } from "../components/ui";

/** Starting arguments derived from the tool's JSON schema (defaults, else first enum value, else an empty value). */
function argsFromSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
    else if (p.enum?.length) out[k] = p.enum[0];
    else out[k] = p.type === "boolean" ? false : p.type === "integer" || p.type === "number" ? 0 : "";
  }
  return out;
}

type Mode = "scenario" | "custom";

export default function Simulator({ health }: { health: Health | null }) {
  const scenarios = useAsync(() => api.scenarios());
  const tools = useAsync(() => api.tools());
  const [mode, setMode] = useState<Mode>("scenario");
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [task, setTask] = useState("");
  const [document, setDocument] = useState("");
  const [toolName, setToolName] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [approval, setApproval] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditEvent | null>(null);

  const startCustom = (tool?: ToolInfo) => {
    setMode("custom");
    setTask("");
    setDocument("");
    setToolName(tool?.name ?? "");
    setArgsText(JSON.stringify(tool ? argsFromSchema(tool.arguments_schema) : {}, null, 2));
    setApproval(false);
    setResult(null);
    setError(null);
  };

  const pickTool = (name: string) => {
    setToolName(name);
    const tool = tools.data?.find((t) => t.name === name);
    if (tool) setArgsText(JSON.stringify(argsFromSchema(tool.arguments_schema), null, 2));
  };

  const load = (s: Scenario) => {
    setMode("scenario");
    setSelected(s);
    setTask(s.task);
    setDocument(s.document);
    setToolName(s.tool_call.name);
    setArgsText(JSON.stringify(s.tool_call.arguments, null, 2));
    setApproval(s.human_approval);
    setResult(null);
    setError(null);
  };

  useEffect(() => {
    if (!scenarios.data || selected) return;
    // Deep link from the landing page: #/simulator?scenario=<id>
    const wanted = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("scenario");
    load(scenarios.data.find((s) => s.id === wanted) ?? scenarios.data[0]);
  }, [scenarios.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (mode === "scenario" && !selected) return;
    if (mode === "custom" && (!task.trim() || !toolName.trim())) {
      setError("A custom run needs a task and a tool name.");
      return;
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsText);
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error();
    } catch {
      setError("Arguments must be a JSON object.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      setResult(await api.run({
        ...(mode === "scenario" && selected ? { scenario_id: selected.id } : {}),
        task, document, human_approval: approval,
        tool_call: { name: toolName, arguments: args },
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const maxDoc = health?.limits.max_document_chars ?? 20000;

  return (
    <div className="space-y-6">
      <PageHeader title="Attack simulator"
        subtitle="Each run goes through the real gateway: threat analysis, then deterministic policy, then execution only if allowed." />

      {health && !health.model.configured && (
        <div className="flex gap-3 rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <span className="font-medium text-warn">Live Gemma analysis is not configured.</span>{" "}
            <span className="text-fg-muted">Set <Mono>GEMINI_API_KEY</Mono> in <Mono>backend/.env</Mono>. Until then, sensitive actions fail closed
              and results show "Model not configured", never a fake analysis.</span>
          </div>
        </div>
      )}

      {scenarios.error && <ErrorState message={scenarios.error} onRetry={scenarios.reload} />}
      {scenarios.loading && !scenarios.data && !scenarios.error && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]" aria-busy aria-label="Loading scenarios">
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-[460px]" />
        </div>
      )}
      {scenarios.data && scenarios.data.length === 0 && (
        <Card><EmptyState icon={<Inbox size={28} />} title="The backend returned no scenarios">
          Check <Mono>backend/app/scenarios.py</Mono>. You can still use a custom request.
          <div className="mt-3"><Button onClick={() => startCustom()}><PenLine size={14} /> Custom request</Button></div>
        </EmptyState></Card>
      )}

      {scenarios.data && scenarios.data.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2" role="listbox" aria-label="Scenarios">
            {scenarios.data.map((s) => (
              <button key={s.id} role="option" aria-selected={mode === "scenario" && selected?.id === s.id} onClick={() => load(s)}
                className={cx("w-full rounded-xl border p-4 text-left transition-colors",
                  mode === "scenario" && selected?.id === s.id ? "border-accent/60 bg-ink-800" : "border-ink-700 bg-ink-900 hover:border-ink-600")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-ink-700 font-mono text-[11px]">{s.label}</span>
                    {s.title}
                  </span>
                  {s.analysis === "fixture" && <Badge tone="accent" icon={<FlaskConical size={11} />}>Fixture</Badge>}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{s.summary}</p>
                <p className="mt-2 text-[11px] text-fg-faint">Expected: <span className="text-fg-muted">{DECISION_LABEL[s.expected]}</span></p>
              </button>
            ))}
            <button role="option" aria-selected={mode === "custom"} onClick={() => startCustom(tools.data?.[0])}
              className={cx("w-full rounded-xl border border-dashed p-4 text-left transition-colors",
                mode === "custom" ? "border-accent/60 bg-ink-800" : "border-ink-600 bg-ink-900 hover:border-fg-faint")}>
              <span className="flex items-center gap-2 text-sm font-semibold"><PenLine size={14} className="text-fg-muted" /> Custom request</span>
              <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">Write your own task, untrusted document and tool call. Analyzed by the live model.</p>
            </button>
          </div>

          {(mode === "custom" || selected) && (
            <Card title={mode === "custom" ? "Custom request" : <>Scenario {selected!.label}: {selected!.title}</>}
              icon={mode === "custom" ? <PenLine size={16} /> : <Crosshair size={16} />}
              actions={<Button variant="ghost" onClick={() => (mode === "custom" ? startCustom(tools.data?.find((t) => t.name === toolName)) : load(selected!))}
                title="Reset fields"><RotateCcw size={14} /> Reset</Button>}>
              <div className="space-y-4">
                <div>
                  <Label>User task (trusted)</Label>
                  <input value={task} onChange={(e) => setTask(e.target.value)} maxLength={health?.limits.max_task_chars ?? 2000}
                    aria-label="User task" placeholder={mode === "custom" ? "What the user asked the agent to do" : undefined}
                    className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent" />
                </div>
                <div>
                  <div className="flex justify-between"><Label>Untrusted document</Label>
                    <span className="text-[11px] text-fg-faint">{document.length.toLocaleString()} / {maxDoc.toLocaleString()}</span></div>
                  <textarea value={document} onChange={(e) => setDocument(e.target.value)} maxLength={maxDoc} rows={7}
                    aria-label="Untrusted document" placeholder={mode === "custom" ? "Content the agent read: email, web page, file…" : undefined}
                    className="scroll-thin w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg-muted outline-none focus:border-accent" />
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
                  <div className="space-y-4">
                    <div>
                      <Label>Proposed tool</Label>
                      <input value={toolName} onChange={(e) => pickTool(e.target.value)} maxLength={64} list="registered-tools"
                        aria-label="Proposed tool" spellCheck={false}
                        className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-sm outline-none focus:border-accent" />
                      <datalist id="registered-tools">
                        {tools.data?.map((t) => <option key={t.name} value={t.name}>{humanize(t.sensitivity)}</option>)}
                      </datalist>
                      <ToolHint tools={tools.data} name={toolName} error={tools.error} />
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} className="mt-0.5 accent-accent" />
                      <span>Human approval supplied<span className="block text-xs text-fg-faint">Comes from the operator, never from the model or document.</span></span>
                    </label>
                  </div>
                  <div>
                    <Label>Arguments (JSON)</Label>
                    <textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={5} spellCheck={false} aria-label="Arguments JSON"
                      className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-[12px] text-fg-muted outline-none focus:border-accent" />
                  </div>
                </div>
                {mode === "scenario" && selected?.analysis === "fixture" && (
                  <p className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 p-2 text-xs text-fg-muted">
                    <FlaskConical size={14} className="text-accent" />
                    This scenario uses a deterministic fixture that simulates a fooled model (low risk, recommends allow). No model is called.
                  </p>
                )}
                {error && <ErrorState message={error} />}
                <div className="flex items-center gap-3">
                  <Button variant="primary" onClick={run} disabled={running}>
                    {running ? <Spinner label="Analyzing and enforcing…" /> : <><Play size={14} /> Run through gateway</>}
                  </Button>
                  {result && <span className="text-xs text-fg-faint">Event <Mono>{result.event_id}</Mono> recorded</span>}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-4" aria-live="polite">
          <Verdict event={result} />
          <EventPanels event={result} />
        </div>
      )}
    </div>
  );
}

function ToolHint({ tools, name, error }: { tools: ToolInfo[] | null; name: string; error: string | null }) {
  if (error) return <p className="mt-1 text-[11px] text-warn">Could not load registered tools: {error}</p>;
  if (!tools || !name) return null;
  const tool = tools.find((t) => t.name === name);
  if (!tool) return <p className="mt-1 text-[11px] text-warn">Not a registered tool. The gateway will deny it by default.</p>;
  return <p className="mt-1 text-[11px] text-fg-faint">{tool.description} <span className="text-fg-muted">({humanize(tool.sensitivity)})</span></p>;
}

function Verdict({ event }: { event: AuditEvent }) {
  const d = event.policy.decision;
  const style = {
    allow: { cls: "border-good/50 bg-good/10 text-good", icon: <CheckCircle2 size={28} />, word: "ALLOW" },
    block: { cls: "border-bad/50 bg-bad/10 text-bad-fg", icon: <Ban size={28} />, word: "BLOCK" },
    needs_approval: { cls: "border-warn/50 bg-warn/10 text-warn", icon: <Hand size={28} />, word: "NEEDS APPROVAL" },
  }[d];
  return (
    <div className={cx("flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-5 py-4", style.cls)} role="status">
      <span className="flex items-center gap-3">{style.icon}<span className="text-2xl font-bold tracking-wide">{style.word}</span></span>
      <span className="min-w-0 flex-1 text-sm text-fg">
        {event.policy.reason}
        <span className="mt-0.5 block text-xs text-fg-muted">
          {event.policy.matched_policy ? <>Matched policy <Mono>{event.policy.matched_policy}</Mono> · </> : null}
          Tool {event.execution.status === "executed" ? "executed" : event.execution.status === "failed" ? "failed" : "was not executed"}
          {event.model_vs_policy.model_recommendation && <> · model recommended <strong className="font-semibold">{event.model_vs_policy.model_recommendation}</strong></>}
        </span>
      </span>
    </div>
  );
}
