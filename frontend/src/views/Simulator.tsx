import { useEffect, useState } from "react";
import { AlertTriangle, Crosshair, FlaskConical, Play, Radio, RotateCcw } from "lucide-react";
import { api } from "../api";
import type { AuditEvent, Health, Scenario } from "../types";
import { EventPanels } from "../components/EventPanels";
import { Badge, Button, Card, DECISION_LABEL, ErrorState, Label, Mono, Spinner, cx, useAsync, PageHeader } from "../components/ui";

export default function Simulator({ health }: { health: Health | null }) {
  const scenarios = useAsync(() => api.scenarios());
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [task, setTask] = useState("");
  const [document, setDocument] = useState("");
  const [toolName, setToolName] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [approval, setApproval] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditEvent | null>(null);

  const load = (s: Scenario) => {
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
    if (scenarios.data && !selected) load(scenarios.data[0]);
  }, [scenarios.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!selected) return;
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
        scenario_id: selected.id, task, document, human_approval: approval,
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
      {scenarios.loading && <Spinner label="Loading scenarios…" />}

      {scenarios.data && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2" role="listbox" aria-label="Scenarios">
            {scenarios.data.map((s) => (
              <button key={s.id} role="option" aria-selected={selected?.id === s.id} onClick={() => load(s)}
                className={cx("w-full rounded-lg border p-3 text-left transition-colors",
                  selected?.id === s.id ? "border-accent/60 bg-ink-800" : "border-ink-700 bg-ink-900 hover:border-ink-600")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-ink-700 font-mono text-[11px]">{s.label}</span>
                    {s.title}
                  </span>
                  {s.analysis === "fixture"
                    ? <Badge tone="accent" icon={<FlaskConical size={11} />}>Fixture</Badge>
                    : <Badge icon={<Radio size={11} />}>Live</Badge>}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{s.summary}</p>
                <p className="mt-2 text-[11px] text-fg-faint">Expected: <span className="text-fg-muted">{DECISION_LABEL[s.expected]}</span></p>
              </button>
            ))}
          </div>

          {selected && (
            <Card title={<>Scenario {selected.label}: {selected.title}</>} icon={<Crosshair size={16} />}
              actions={<Button variant="ghost" onClick={() => load(selected)} title="Reset fields"><RotateCcw size={14} /> Reset</Button>}>
              <div className="space-y-4">
                <div>
                  <Label>User task (trusted)</Label>
                  <input value={task} onChange={(e) => setTask(e.target.value)} maxLength={2000}
                    className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent" />
                </div>
                <div>
                  <div className="flex justify-between"><Label>Untrusted document</Label>
                    <span className="text-[11px] text-fg-faint">{document.length.toLocaleString()} / {maxDoc.toLocaleString()}</span></div>
                  <textarea value={document} onChange={(e) => setDocument(e.target.value)} maxLength={maxDoc} rows={7}
                    className="scroll-thin w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg-muted outline-none focus:border-accent" />
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
                  <div className="space-y-4">
                    <div>
                      <Label>Proposed tool</Label>
                      <input value={toolName} onChange={(e) => setToolName(e.target.value)} maxLength={64}
                        className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-sm outline-none focus:border-accent" />
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} className="mt-0.5 accent-[#5b9cf2]" />
                      <span>Human approval supplied<span className="block text-xs text-fg-faint">Comes from the operator, never from the model or document.</span></span>
                    </label>
                  </div>
                  <div>
                    <Label>Arguments (JSON)</Label>
                    <textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={5} spellCheck={false}
                      className="w-full rounded-md border border-ink-600 bg-ink-950 px-3 py-2 font-mono text-[12px] text-fg-muted outline-none focus:border-accent" />
                  </div>
                </div>
                {selected.analysis === "fixture" && (
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

      {result && <EventPanels event={result} />}
    </div>
  );
}
