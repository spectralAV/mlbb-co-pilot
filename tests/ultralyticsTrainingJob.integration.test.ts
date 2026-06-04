import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  getUltralyticsTrainingStatus,
  rehydrateUltralyticsTrainingJob,
  resetUltralyticsTrainingJobForTest,
  setUltralyticsTrainingJobTestOverrides,
  stopUltralyticsTrainingJob,
  type UltralyticsTrainingJob,
} from "../backend/src/vision/ultralyticsTrainingJob.ts";

const projectRoot = path.resolve(process.cwd(), "..");
const tempRoot = path.join(projectRoot, "data", "cv", "runtime", "test-training-job");

function samplePersistedJob(overrides: Partial<UltralyticsTrainingJob> = {}): UltralyticsTrainingJob {
  const now = new Date().toISOString();
  return {
    id: "train-integration",
    state: "training",
    command: ["wsl.exe", "train"],
    cwd: projectRoot,
    trainingScope: "full",
    runName: "mlbb-detection",
    artifactPaths: {
      weights: path.join(projectRoot, "data/cv/models/mlbb-detect.pt"),
      onnx: path.join(projectRoot, "data/cv/models/mlbb-detect.onnx"),
      runDir: path.join(projectRoot, "data/cv/runs/mlbb-detection"),
      bestWeights: path.join(projectRoot, "data/cv/runs/mlbb-detection/weights/best.pt"),
      lastWeights: path.join(projectRoot, "data/cv/runs/mlbb-detection/weights/last.pt"),
    },
    stagedWorkspace: "/tmp/staged",
    runPath: path.join(projectRoot, "data/cv/runs/mlbb-detection"),
    statusFile: path.join(tempRoot, "training-job.json"),
    startedAt: now,
    updatedAt: now,
    elapsedMs: 1200,
    pid: null,
    childPids: [999],
    runtime: "wsl",
    trainingPython: "/usr/bin/python3",
    error: null,
    exitCode: null,
    signal: null,
    artifactsReady: false,
    stuckReason: null,
    result: null,
    ...overrides,
  };
}

test("rehydrateUltralyticsTrainingJob resumes WSL training when probe finds processes", async (t) => {
  await mkdir(tempRoot, { recursive: true });
  const statusPath = path.join(tempRoot, "training-job.json");
  t.after(async () => {
    resetUltralyticsTrainingJobForTest();
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(statusPath, `${JSON.stringify(samplePersistedJob())}\n`, "utf8");
  setUltralyticsTrainingJobTestOverrides({
    statusFilePath: statusPath,
    phaseFilePath: path.join(tempRoot, "training-job-phase.json"),
    probeWslProcesses: async () => ({
      distro: "Ubuntu-24.04",
      python: "/usr/bin/python3",
      linuxPids: [4242],
      processes: [{ pid: 4242, cwd: null, cmdline: "ultralyticsVision.py train --job-id train-integration", children: [] }],
    }),
  });

  const job = await rehydrateUltralyticsTrainingJob();
  assert.equal(job.state, "training");
  assert.equal(job.rehydrated, true);
  assert.deepEqual(job.wsl?.linuxPids, [4242]);
});

test("stopUltralyticsTrainingJob clears rehydrated WSL job without calling real wsl.exe", async (t) => {
  await mkdir(tempRoot, { recursive: true });
  const statusPath = path.join(tempRoot, "training-job.json");
  let killCalled = false;
  t.after(async () => {
    resetUltralyticsTrainingJobForTest();
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(statusPath, `${JSON.stringify(samplePersistedJob({ state: "stuck", stuckReason: "test stuck" }))}\n`, "utf8");
  setUltralyticsTrainingJobTestOverrides({
    statusFilePath: statusPath,
    phaseFilePath: path.join(tempRoot, "training-job-phase.json"),
    probeWslProcesses: async () => ({
      distro: "Ubuntu-24.04",
      python: "/usr/bin/python3",
      linuxPids: [],
      processes: [],
    }),
    killWslTrainingTree: async () => {
      killCalled = true;
    },
  });
  await rehydrateUltralyticsTrainingJob();

  const stopped = await stopUltralyticsTrainingJob();
  assert.equal(stopped.state, "killed");
  const persisted = JSON.parse(await readFile(statusPath, "utf8")) as UltralyticsTrainingJob;
  assert.equal(persisted.state, "killed");
  assert.equal(getUltralyticsTrainingStatus().state, "killed");
  assert.equal(killCalled, true);
});
