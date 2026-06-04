/**
 * Replay draft lifecycle scenarios against a running backend (no live match required).
 *
 *   node tools/replay-draft-scenarios.mjs
 *   node tools/replay-draft-scenarios.mjs --base http://127.0.0.1:8787 --id pre_lock_ally_pick_swap
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const scenarios = JSON.parse(
  fs.readFileSync(new URL("../data/recognition-samples/draft-lifecycle-scenarios.json", import.meta.url), "utf8"),
);

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:8787";
const onlyId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;
const delayMs = Number(args.includes("--delay") ? args[args.indexOf("--delay") + 1] : 400);

const list = scenarios.scenarios.filter((scenario) => !onlyId || scenario.id === onlyId);
if (!list.length) {
  console.error(onlyId ? `Unknown scenario id: ${onlyId}` : "No scenarios found.");
  process.exit(1);
}

for (const scenario of list) {
  console.log(`\n=== ${scenario.id} ===\n${scenario.description ?? ""}`);
  for (const [index, frame] of scenario.frames.entries()) {
    const payload = {
      timestamp: Date.now(),
      frameId: `replay:${scenario.id}:${index + 1}`,
      ...frame,
    };
    const response = await fetch(`${base}/api/vision/draft/recognition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || !body.success) {
      console.error("ingest failed", response.status, body);
      process.exit(1);
    }
    const state = body.data?.state;
    console.log(
      `frame ${index + 1}:`,
      `allyBans=${(state?.allyBans ?? []).map((s) => `${s.slot}:${s.heroName}`).join(",") || "(none)"}`,
      `allyPicks=${(state?.allyPicks ?? []).map((s) => `${s.slot}:${s.heroName}`).join(",") || "(none)"}`,
      state?.selectedLane?.value ? `lane=${state.selectedLane.value}` : "",
    );
    if (index < scenario.frames.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const latest = await fetch(`${base}/api/vision/draft/latest`).then((res) => res.json());
  console.log("latest:", JSON.stringify(latest.data?.state?.allyBans ?? [], null, 0), JSON.stringify(latest.data?.state?.allyPicks ?? [], null, 0));
}

console.log("\nDone. Open Draft Room with Realtime on to inspect the final state.");
