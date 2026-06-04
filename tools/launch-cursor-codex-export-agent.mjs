#!/usr/bin/env node
/**
 * Launch a Cursor Cloud Agent on gpt-5.3-codex-high that harvests Cursor API data
 * into repo artifacts for Codex to read.
 *
 * Requires: CURSOR_API_KEY (Cursor Dashboard → Integrations → API Keys)
 *
 * Usage:
 *   set CURSOR_API_KEY=cursor_...
 *   node tools/launch-cursor-codex-export-agent.mjs
 *   node tools/launch-cursor-codex-export-agent.mjs --repo https://github.com/spectralAV/mlbb-co-pilot --ref main
 */

const DEFAULT_REPO = "https://github.com/spectralAV/mlbb-co-pilot";
const DEFAULT_REF = "main";
const CODEX_MODEL = "gpt-5.3-codex-high";

const HARVEST_PROMPT = `You are a read-only Cursor API harvest agent. Using the Cursor API (Basic auth: API key as username, empty password; base https://api.cursor.com), collect ALL accessible account data and write artifacts for Codex to read.

Steps (complete all):
1) GET /v1/me, /v1/models, /v1/repositories
2) GET /v1/agents?limit=100 — paginate with cursor until exhausted
3) For each agent id: GET /v1/agents/{id}, GET /v1/agents/{id}/runs?limit=100 (paginate), GET /v1/agents/{id}/artifacts
4) For each agent, fetch conversation/messages if the API exposes them for that agent
5) Write artifacts/cursor-api-snapshot.json — full raw JSON bundle
6) Write artifacts/cursor-data-report.md — summary tables, empty-state notes, errors
7) Add section "Codex readout" — what a reader should take away

Rules: read-only API calls only; do not modify application source code; do not commit secrets into the repo (redact tokens in markdown if any appear in API responses).`;

function parseArgs(argv) {
  const out = { repo: DEFAULT_REPO, ref: DEFAULT_REF };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) out.repo = argv[++i];
    else if (argv[i] === "--ref" && argv[i + 1]) out.ref = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node tools/launch-cursor-codex-export-agent.mjs [--repo URL] [--ref BRANCH]`);
    process.exit(0);
  }

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing CURSOR_API_KEY. Create one at https://cursor.com/dashboard/integrations");
    process.exit(1);
  }

  const body = {
    name: "Cursor data export for Codex",
    prompt: { text: HARVEST_PROMPT },
    model: { id: CODEX_MODEL },
    repos: [{ url: args.repo, startingRef: args.ref }],
    skipReviewerRequest: true,
    mode: "agent",
  };

  const res = await fetch("https://api.cursor.com/v1/agents", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`Non-JSON response (${res.status}):`, text.slice(0, 2000));
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Create agent failed (${res.status}):`, JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const agent = json.agent ?? json;
  const run = json.run;
  console.log("Cloud agent launched (Codex model).");
  console.log("  agent id:", agent.id);
  console.log("  status:  ", agent.status);
  console.log("  url:     ", agent.url);
  if (run?.id) console.log("  run id:  ", run.id, "status:", run.status);
  console.log("\nTrack progress in the Cursor dashboard or poll GET /v1/agents/" + agent.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
