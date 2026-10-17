# ToolFence

**A runtime security gateway for AI agent tool calls.**

AI agents read untrusted documents and call tools. A malicious document can try to steer an agent into
unauthorized actions, such as exporting customer data. ToolFence sits on the tool-execution path:

> **Gemma analyzes the threat. ToolFence enforces permissions. The audit log records the evidence.**

ToolFence protects only the tool calls that go through the gateway. It does not claim to solve prompt
injection in general.

## How it works

```
task + untrusted document + proposed tool call
        │
        ▼
 1. Gemma threat analysis  ──► structured JSON, validated with Pydantic (untrusted, advisory)
        │
        ▼
 2. Deterministic policy engine (in order)
      deny unknown tools → allowlist → argument schema → approved destinations
      → fail closed without analysis → model risk gate (can only tighten) → human approval
        │
        ├── block / needs approval ──► tool is never invoked
        ▼
 3. Execution: an HMAC-signed, single-use permit is required to run a (synthetic) tool
        │
        ▼
 4. Full event persisted to SQLite ──► dashboard
```

The model's `recommendation` is never used to grant access. If the model errors, times out or returns
malformed output, sensitive actions **fail closed**. Read-only tools may proceed when policy allows it.

## Demo scenarios

| | Scenario | Tool | Result |
|---|---|---|---|
| A | Safe read | `get_customer_count` | Allowed, returns 42 (synthetic) |
| B | Indirect prompt injection | `export_customer_data` | Blocked before execution |
| C | Unauthorized destination (lookalike domain) | `send_report` | Blocked by destination policy |
| D | Model disagreement (deterministic fixture says "allow") | `delete_customer_records` | Blocked; policy overrides the model |

All data and tools are synthetic: nothing is emailed, exported or deleted.

## Stack

- **Backend:** Python, FastAPI, Pydantic, SQLite, `google-genai` (hosted Gemma, default `gemma-4-26b-a4b-it`)
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide, Recharts

## Setup: Windows PowerShell

Requires Python 3.9+ and Node.js 18+.

**Backend** (terminal 1):
```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env      # then edit .env and set GEMINI_API_KEY
python scripts\check_gemma.py    # optional: verify the Gemma model ID works
uvicorn app.main:app --reload --port 8000
```
If activation is blocked, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

**Frontend** (terminal 2):
```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` to the backend, so the API key never
reaches the browser.

## Setup: macOS / Linux

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt && cp .env.example .env   # set GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
# second terminal
cd frontend && npm install && npm run dev
```

## Tests

```bash
cd backend && python -m pytest -q
```

All model responses are mocked, so the tests never call a paid or rate-limited API. They cover the allowlist,
unknown tools, destinations and lookalike domains, model-vs-policy disagreement, invalid arguments,
model errors, timeouts and malformed output, audit persistence, policy changes, and proof (via spies) that
blocked tools are never invoked.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status; `?check_model=true` runs a live model probe |
| GET | `/api/scenarios` | Demo scenarios |
| GET | `/api/tools` | Registered tools and schemas |
| POST | `/api/simulations/run` | Run a request through the gateway |
| GET | `/api/audit` | Events (`decision`, `severity`, `scenario`, `q`, `limit`, `offset`) |
| GET | `/api/audit/{event_id}` | One event |
| GET | `/api/policies` | Policies and change history |
| PATCH | `/api/policies/{policy_id}` | Update a policy (validated; locked policies cannot be disabled) |
| GET | `/api/metrics` | Dashboard figures from persisted events |

Interactive docs: http://localhost:8000/docs

## Limitations and security assumptions

- Protection covers only tool calls routed through the gateway; a tool called directly is not protected.
- Gemma's analysis is advisory and can itself be manipulated. That is why it can only tighten decisions.
- Human approval is a request flag in this demo; production would need authenticated approvers.
- The demo API has no authentication. Run it locally only.
- Permits are signed with a per-process key; restarting the backend invalidates outstanding permits.
- MCP integration is not included. The official `mcp` Python SDK requires Python 3.10+.

## License

MIT. See [LICENSE](LICENSE).
