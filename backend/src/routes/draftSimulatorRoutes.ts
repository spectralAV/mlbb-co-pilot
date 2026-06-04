import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getMlbbAdbAssetStatus } from "../services/mlbbAdbAssets.js";
import { evaluateDraftScenarioExpect } from "../vision/draftScenarioExpect.js";
import { getLatestDraftRecognition, ingestDraftRecognition, resetDraftRecognition } from "../vision/draftRecognition.js";
import { resetMatchState } from "../state/matchState.js";
import { resetDraftSlotStabilizer } from "../state/draftStabilizer.js";

const projectRoot = path.resolve(process.cwd(), "..");
const scenariosPath = path.join(projectRoot, "data", "recognition-samples", "draft-lifecycle-scenarios.json");
const referenceFrames = [
  { id: "last-adb", label: "Last ADB capture", file: path.join(projectRoot, "data", "cache", "last-adb-frame.png") },
];

type ScenarioFile = {
  scenarios: Array<{
    id: string;
    description?: string;
    frames: Array<Record<string, unknown>>;
    expect?: Record<string, unknown>;
  }>;
};

async function readScenarios(): Promise<ScenarioFile> {
  return JSON.parse(await readFile(scenariosPath, "utf8")) as ScenarioFile;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function draftSimulatorRoutes(app: FastifyInstance) {
  app.get("/api/draft/simulator/scenarios", async () => {
    const file = await readScenarios();
    return {
      success: true,
      data: file.scenarios.map((scenario) => ({
        id: scenario.id,
        description: scenario.description ?? "",
        frameCount: scenario.frames.length,
        expect: scenario.expect ?? {},
      })),
    };
  });

  app.get("/api/draft/simulator/assets-status", async () => ({
    success: true,
    data: await getMlbbAdbAssetStatus(),
  }));

  app.get("/api/draft/simulator/reference-frames", async () => {
    const frames = [];
    for (const frame of referenceFrames) {
      try {
        const info = await readFile(frame.file).then((buf) => buf.length);
        frames.push({ id: frame.id, label: frame.label, bytes: info, available: true });
      } catch {
        frames.push({ id: frame.id, label: frame.label, bytes: 0, available: false });
      }
    }
    return { success: true, data: frames };
  });

  app.get("/api/draft/simulator/reference-frame/:id", async (req, reply) => {
    const id = String((req.params as { id?: string }).id ?? "last-adb");
    const frame = referenceFrames.find((entry) => entry.id === id);
    if (!frame) return reply.code(404).send({ success: false, error: "Unknown reference frame" });
    try {
      const bytes = await readFile(frame.file);
      return reply.header("cache-control", "no-store").type("image/png").send(bytes);
    } catch {
      return reply.code(404).send({ success: false, error: "Reference frame not on disk" });
    }
  });

  app.post("/api/draft/simulator/replay", async (req, reply) => {
    const body = (req.body ?? {}) as { scenarioId?: string; delayMs?: number; reset?: boolean };
    const scenarioId = String(body.scenarioId ?? "").trim();
    const delayMs = Math.max(0, Math.min(5000, Number(body.delayMs ?? 400)));
    const file = await readScenarios();
    const scenario = file.scenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) return reply.code(404).send({ success: false, error: `Unknown scenario: ${scenarioId}` });

    if (body.reset !== false) {
      resetMatchState();
      resetDraftRecognition();
      resetDraftSlotStabilizer();
    }

    const steps: Array<{ index: number; allyBans: string[]; allyPicks: string[]; selectedLane?: string }> = [];
    for (const [index, frame] of scenario.frames.entries()) {
      const rawPhase = String(frame.phase ?? "pick");
      const phase =
        rawPhase === "ban" || rawPhase === "pick" || rawPhase === "finalize" || rawPhase === "loading"
          ? rawPhase
          : "pick";
      const result = await ingestDraftRecognition({
        timestamp: Date.now(),
        frameId: `simulator:${scenario.id}:${index + 1}`,
        ...frame,
        phase,
      });
      const state = result?.state;
      steps.push({
        index: index + 1,
        allyBans: (state?.allyBans ?? []).map((slot: { slot?: number; heroName?: string }) => `${slot.slot}:${slot.heroName}`),
        allyPicks: (state?.allyPicks ?? []).map((slot: { slot?: number; heroName?: string }) => `${slot.slot}:${slot.heroName}`),
        selectedLane: state?.selectedLane?.value,
      });
      if (index < scenario.frames.length - 1) await sleep(delayMs);
    }

    const latest = getLatestDraftRecognition();
    const expect = scenario.expect ?? {};
    const evaluation = evaluateDraftScenarioExpect(expect, latest?.state);

    return {
      success: true,
      data: {
        scenarioId: scenario.id,
        steps,
        latest,
        expect,
        passed: evaluation.ok,
        failures: evaluation.failures,
      },
    };
  });
}
