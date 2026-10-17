# ToolFence

# 🛡️ ToolFence

### Runtime Security Gateway for AI Agents

**Analyze threats. Enforce permissions. Audit every action.**

ToolFence is an AI agent security gateway that uses Google's **Gemma** to analyze suspicious instructions and proposed tool calls, combined with a deterministic policy engine that prevents unauthorized actions from executing.

Built for **Hacktoberfest Hack Day Mumbai 2026**.

---

## 🚨 The Problem

AI agents can read documents, interact with tools, and perform actions on behalf of users. However, untrusted content may contain malicious instructions designed to manipulate an agent into attempting unauthorized actions, such as exporting sensitive data or sending information to unapproved destinations.

Detecting suspicious instructions is not enough. Applications also need an enforcement layer that prevents unauthorized actions from executing.

## 💡 Our Solution

ToolFence introduces a security checkpoint between an AI agent and its protected tools.

- 🧠 **Gemma-powered threat analysis:** Analyze untrusted content and proposed tool calls to identify suspicious instructions and potential threats.
- 🛡️ **Deterministic policy enforcement:** Validate tool permissions, arguments, destinations, and approval requirements before execution.
- 🚫 **Unauthorized action blocking:** Reject prohibited tool calls independently of the model's recommendation.
- 📋 **Audit logging:** Record attempted actions, threat assessments, policy decisions, and execution results.
- 📊 **Security dashboard:** Visualize requests, threats, enforcement decisions, and audit events.
- 🔌 **MCP integration:** Planned extension for exposing protected tools to compatible AI clients.

## ⚙️ How It Works

1. An agent proposes an action using information that may include untrusted content.
2. Gemma analyzes the context and returns a structured threat assessment.
3. ToolFence validates the assessment and applies deterministic security policies.
4. Authorized actions execute through protected mock tools; unauthorized actions are rejected before execution.
5. Every decision is recorded in an audit log.

**Core principle:** Gemma analyzes the threat. ToolFence enforces permissions.

The policy engine—not the language model—is responsible for authorization.

## 🎯 Demo Scenarios

| Scenario | Expected outcome |
|---|---|
| Safe read operation | Authorized mock tool executes |
| Indirect prompt injection | Unauthorized export is blocked |
| Unauthorized destination | Policy rejects the action |
| Model disagreement | Prohibited action remains blocked even when the model recommends allowing it |

The scenarios use synthetic data and simulated operations. ToolFence protects only actions routed through its enforcement layer and does not claim to prevent every prompt-injection attack.

## 🏗️ Architecture

```text
          Untrusted Content
                  |
                  v
        +-------------------+
        |  Gemma API        |
        |  Threat Analysis  |
        +-------------------+
                  |
                  v
        +-------------------+
        |  Policy Engine    |
        |  Python + Pydantic|
        +-------------------+
                  |
            +-----+-----+
            |           |
            v           v
        ALLOW         BLOCK
            |           |
            v           v
        Mock Tool    No Execution
            |           |
            +-----+-----+
                  |
                  v
        +-------------------+
        | SQLite Audit Log  |
        +-------------------+
                  |
                  v
        +-------------------+
        | React Dashboard   |
        +-------------------+
```

## 🧰 Tech Stack

**Frontend**
- React
- TypeScript
- Vite
- Tailwind CSS
- Recharts
- Lucide React

**Backend**
- Python
- FastAPI
- Pydantic
- SQLite

**AI**
- Google Gemma through the hosted API
- Google Gen AI Python SDK

## 🚀 Getting Started

### Prerequisites

- Python 3.10 or later
- Node.js and npm
- A Google AI API key with access to a supported Gemma model

### 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd ToolFence
```

Replace the placeholder with your repository URL.

### 2. Configure the backend

Create and activate a virtual environment:

**Windows PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies:

```powershell
pip install -r backend/requirements.txt
```

Create a `.env` file in the backend directory using the provided `.env.example` as a template.

Configure:

```env
GEMINI_API_KEY=your_api_key_here
GEMMA_MODEL=gemma-4-26b-a4b-it
```

Use a model ID supported by your API account. Never commit your `.env` file or expose the API key in frontend code.

### 3. Start the backend

Use the actual FastAPI module path documented by the project. For example:

```powershell
python -m uvicorn app.main:app --reload
```

### 4. Start the frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite.

**Note:** The commands and directory paths above assume the repository follows this layout. Update them if the implementation differs.

## 🧪 Testing

Run the backend tests using the project's documented test configuration. For a typical pytest setup:

```powershell
python -m pytest
```

Verify that:

- Authorized read operations execute successfully.
- Unknown tools and unauthorized destinations are blocked.
- Model recommendations cannot override prohibited-tool policies.
- Model failures cannot authorize protected actions.
- Blocked operations never invoke their protected execution functions.
- Audit events persist in SQLite.

## 🔐 Security Principles

- Deny unknown tools by default.
- Validate arguments before execution.
- Keep API credentials on the backend.
- Treat model output as untrusted input.
- Enforce permissions independently of model-generated recommendations.
- Use synthetic data for demonstrations.
- Record enforcement decisions for inspection.

## 🗺️ Roadmap

- [x] Hosted Gemma API connectivity tested
- [ ] Complete runtime policy engine
- [ ] Interactive security dashboard
- [ ] Live attack simulation
- [ ] Persistent audit explorer
- [ ] Automated security tests
- [ ] Public repository and documentation
- [ ] MCP integration

Roadmap items describe intended work and should be updated as features are implemented and tested.

## 🌍 Open Source

ToolFence is intended to be an open-source project. The repository should include an explicit open-source license before distribution.

Contributions, feedback, and security-focused improvements are welcome.

## 👥 Built By

**Udit and Anup**

Built at **Hacktoberfest Hack Day Mumbai 2026**.

---

*ToolFence demonstrates how model-based threat analysis can work alongside deterministic security controls. It is a prototype, not a guarantee of complete AI-agent security.*
