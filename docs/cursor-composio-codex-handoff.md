# Cursor + Composio session handoff (for Codex)

Generated: 2026-06-04 (UTC). This file summarizes work done in Cursor IDE via Composio integration so Codex (or another reader) can continue without chat history.

## Goal

1. Use **Composio** to discover Cursor toolkit tools and list Cloud Agents.
2. **Launch a Cloud Agent** that harvests all accessible Cursor API data for **Codex** (`gpt-5.3-codex-high`) to read.
3. When launch was blocked, **document outcomes** and add a local launcher script.

## Composio connections (active at time of session)

| Toolkit | Status | Notes |
|---------|--------|--------|
| **cursor** | Active | API key name `Composio`, owner `git@spectralav.eu`, created 2026-06-03 |
| **openai** | Connected but broken | `OPENAI_CREATE_RESPONSE` returned 401 invalid API key (key looked like a Cursor key, not `sk-...`) |
| **github** | User had connected (not used in this session) |

## Cursor tools available via Composio

Composio search and execution only exposed **read** tools (no create/launch):

| Tool slug | Purpose |
|-----------|---------|
| `CURSOR_GET_ME` | API key metadata (name, createdAt, userEmail) |
| `CURSOR_LIST_AGENTS` | Paginated cloud agents (`limit` 1–100, optional `cursor`) |
| `CURSOR_LIST_MODELS` | Available model IDs for API |
| `CURSOR_LIST_REPOSITORIES` | GitHub repos accessible through Cursor |
| `CURSOR_GET_AGENT_CONVERSATION` | Messages for one agent (`id` required, `bc-...` prefix) |

Toolkit description mentions Admin, Analytics, and AI Code Tracking; those were **not** returned as callable Composio tools in this session.

## Cursor API snapshot (exported via Composio)

```json
{
  "exportedAt": "2026-06-04",
  "me": {
    "apiKeyName": "Composio",
    "createdAt": "2026-06-03T20:32:15.395Z",
    "userEmail": "git@spectralav.eu"
  },
  "models": [
    "composer-2.5",
    "claude-opus-4-8-thinking-high",
    "claude-opus-4-8-thinking-high-fast",
    "gpt-5.5-high",
    "gpt-5.5-high-fast",
    "gpt-5.3-codex-high",
    "gpt-5.3-codex-high-fast",
    "claude-opus-4-7-thinking-high",
    "claude-opus-4-7-thinking-high-fast",
    "gpt-5.4-high",
    "gpt-5.4-high-fast",
    "claude-4.6-opus-high-thinking"
  ],
  "repositories": [
    {
      "name": "mlbb-co-pilot",
      "owner": "spectralAV",
      "repository": "https://github.com/spectralAV/mlbb-co-pilot"
    },
    {
      "name": "spectralAV",
      "owner": "spectralAV",
      "repository": "https://github.com/spectralAV/spectralAV"
    }
  ],
  "agents": []
}
```

**Interpretation:** Auth succeeded; agent list was empty (not an error). No agent conversations were fetched because there were no agent IDs.

## Cloud agent launch attempt

### Intended behavior

- **Model:** `gpt-5.3-codex-high` (Codex in Cursor Cloud Agents API).
- **Repo:** `https://github.com/spectralAV/mlbb-co-pilot`, branch `main`.
- **Task:** Read-only harvest of Cursor API (`/v1/me`, models, repositories, agents with pagination, per-agent runs/artifacts/conversations), write:
  - `artifacts/cursor-api-snapshot.json`
  - `artifacts/cursor-data-report.md` (includes a "Codex readout" section)

### Blockers encountered

1. **No Composio tool** for `POST /v1/agents` (create agent).
2. **Composio `proxy_execute` disabled** for the org (`ExternalProxy_OrgNotAllowed` / code 2812) — cannot call Cursor REST API through Composio workbench.
3. **`CURSOR_API_KEY` not set** in the agent’s shell when running the local launcher — script exited with a clear message.
4. **OpenAI via Composio** failed with 401 when trying to send the snapshot to `OPENAI_CREATE_RESPONSE` / `gpt-5.3-codex-high`.

### Deliverable added in repo

**`tools/launch-cursor-codex-export-agent.mjs`**

- Calls `POST https://api.cursor.com/v1/agents` with Basic auth (`CURSOR_API_KEY` as username, empty password).
- Requires `CURSOR_API_KEY` in the environment (from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)).

```powershell
$env:CURSOR_API_KEY = "cursor_..."
node tools/launch-cursor-codex-export-agent.mjs
# optional: --repo URL --ref BRANCH
```

On success, prints agent `id`, `status`, and dashboard `url`.

### API reference used

- Cloud Agents API: https://cursor.com/docs/cloud-agent/api/endpoints
- Create agent: `POST /v1/agents` with `prompt.text`, `model.id`, `repos[]`, optional `mcpServers`, etc.
- Cursor SDK skill (local/cloud patterns): `Agent.create` with `cloud: { repos: [...] }` — same product surface, not used in repo yet (no `@cursor/sdk` dependency).

## Composio meta tools used

- `COMPOSIO_SEARCH_TOOLS` — discover Cursor/OpenAI tools and plans.
- `COMPOSIO_MULTI_EXECUTE_TOOL` — run `CURSOR_*` and attempted `OPENAI_CREATE_RESPONSE`.
- `COMPOSIO_REMOTE_WORKBENCH` + `proxy_execute` — **failed** (org not allowed).

Session IDs from Composio (for correlation only): `salt`, `love`.

## Recommended next steps for Codex

1. **Read this file** plus `tools/launch-cursor-codex-export-agent.mjs` for full launch intent and prompt text.
2. If the user sets `CURSOR_API_KEY`, run the launcher and poll `GET /v1/agents/{id}` until artifacts exist on the agent branch.
3. After agents exist, use Composio `CURSOR_LIST_AGENTS` + `CURSOR_GET_AGENT_CONVERSATION` per `bc-...` id, or re-run the cloud harvest agent.
4. Fix Composio **OpenAI** connection if analysis should run on OpenAI Codex outside Cursor Cloud.
5. Request Composio **proxy_execute** enablement if all Cursor REST calls must go through Composio only.

## Repo context (MLBB CoPilot)

Unrelated to Composio but present in the workspace: MLBB CoPilot is a tactical assistant for Mobile Legends with CV/draft recognition, backend vision routes, frontend live capture, draft simulator work in progress (see git status at session time). This handoff is only about **Cursor API + Composio + Codex export** automation.

**See also:** `docs/codex-cv-session-handoff.md` — CV/training work (dataset rebuild, YOLO screen gate, minimap merge, next steps).
