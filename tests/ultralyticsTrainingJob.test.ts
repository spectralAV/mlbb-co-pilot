import assert from "node:assert/strict";
import test from "node:test";
import {
  STUCK_WITH_ARTIFACTS_MS,
  applyProcessExit,
  buildWslKillCommand,
  canStartUltralyticsTraining,
  detectStuckWithArtifacts,
  parsePgrepAfOutput,
  parseWslProcessProbe,
  trainingJobIsActive,
  type UltralyticsTrainingJob,
} from "../backend/src/vision/ultralyticsTrainingJob.ts";

function sampleJob(overrides: Partial<UltralyticsTrainingJob> = {}): UltralyticsTrainingJob {
  const now = new Date().toISOString();
  return {
    id: "train-test",
    state: "training",
    command: ["wsl.exe", "train"],
    cwd: "/project",
    trainingScope: "full",
    runName: "mlbb-detection",
    artifactPaths: {
      weights: "data/cv/models/mlbb-detect.pt",
      onnx: "data/cv/models/mlbb-detect.onnx",
      runDir: "data/cv/runs/mlbb-detection",
      bestWeights: "data/cv/runs/mlbb-detection/weights/best.pt",
      lastWeights: "data/cv/runs/mlbb-detection/weights/last.pt",
    },
    stagedWorkspace: "/home/user/.mlbb-copilot/training/full",
    runPath: "data/cv/runs/mlbb-detection",
    statusFile: "data/cv/runtime/training-job.json",
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    pid: 4242,
    childPids: [4243],
    runtime: "wsl",
    trainingPython: "/home/user/.mlbb-copilot/cv-rocm/bin/python",
    error: null,
    exitCode: null,
    signal: null,
    artifactsReady: false,
    stuckReason: null,
    result: null,
    ...overrides,
  };
}

test("training job state transitions treat active phases as busy", () => {
  assert.equal(trainingJobIsActive("starting"), true);
  assert.equal(trainingJobIsActive("training"), true);
  assert.equal(trainingJobIsActive("validating"), true);
  assert.equal(trainingJobIsActive("mirroring"), true);
  assert.equal(trainingJobIsActive("completed"), false);
  assert.equal(trainingJobIsActive("idle"), false);
});

test("cannot start duplicate training while a job is active", () => {
  assert.equal(canStartUltralyticsTraining(null), true);
  assert.equal(canStartUltralyticsTraining(sampleJob({ state: "idle" })), true);
  assert.equal(canStartUltralyticsTraining(sampleJob({ state: "completed" })), true);
  assert.equal(canStartUltralyticsTraining(sampleJob({ state: "failed" })), true);
  assert.equal(canStartUltralyticsTraining(sampleJob({ state: "training" })), false);
  assert.equal(canStartUltralyticsTraining(sampleJob({ state: "stuck" })), true);
});

test("stop kills process tree command path includes pt_data_worker cleanup", () => {
  const command = buildWslKillCommand("Ubuntu-24.04", "train-abc123");
  assert.deepEqual(command.slice(0, 2), ["bash", "-c"]);
  const script = command[2];
  assert.match(script, /ltralyticsVision\.py train/);
  assert.match(script, /--job-id train-abc123/);
  assert.match(script, /t_data_worker/);
  assert.match(script, /pkill -KILL/);
});

test("parsePgrepAfOutput parses pid + cmdline lines and collects all worker pids", () => {
  const output = [
    "447 /home/u/.mlbb-copilot/cv-rocm/bin/python tools/ultralyticsVision.py train --job-id train-x",
    "1027 /home/u/.mlbb-copilot/cv-rocm/bin/python tools/ultralyticsVision.py train --job-id train-x",
    "",
    "1051 /home/u/.mlbb-copilot/cv-rocm/bin/python tools/ultralyticsVision.py train --job-id train-x",
  ].join("\n");
  const probe = parsePgrepAfOutput(output, "Ubuntu-24.04", "/home/u/.mlbb-copilot/cv-rocm/bin/python");
  assert.deepEqual(probe.linuxPids, [447, 1027, 1051]);
  assert.equal(probe.processes[0]?.cmdline?.includes("ultralyticsVision.py train"), true);
});

test("parsePgrepAfOutput returns no pids for empty output", () => {
  const probe = parsePgrepAfOutput("", "Ubuntu-24.04", "python");
  assert.deepEqual(probe.linuxPids, []);
});

test("artifact-present-but-process-alive becomes stuck, not completed", () => {
  const startedAt = new Date(Date.now() - STUCK_WITH_ARTIFACTS_MS - 5000).toISOString();
  const stuck = detectStuckWithArtifacts(
    {
      state: "training",
      artifactsReady: true,
      startedAt,
      elapsedMs: STUCK_WITH_ARTIFACTS_MS + 5000,
    },
    Date.now(),
  );
  assert.equal(stuck.stuck, true);
  assert.equal(applyProcessExit(sampleJob({ state: "training", artifactsReady: true }), 0, null), "completed");
  assert.equal(applyProcessExit(sampleJob({ state: "training", artifactsReady: true }), 1, null), "failed");
  const stuckJob = sampleJob({ state: "stuck", artifactsReady: true });
  assert.equal(applyProcessExit(stuckJob, 0, null), "stuck");
  assert.equal(trainingJobIsActive("stuck"), false);
});

test("parseWslProcessProbe reads cwd, cmdline, and child workers", () => {
  const probe = parseWslProcessProbe(
    [
      "PID=991",
      "CWD=/home/spectral/.mlbb-copilot/training/full",
      "CMD=python backend/tools/ultralyticsVision.py train --job-id train-abc",
      "CHILD=992|python pt_data_worker",
      "",
    ].join("\n"),
    "Ubuntu-24.04",
    "/home/spectral/.mlbb-copilot/cv-rocm/bin/python",
  );
  assert.deepEqual(probe.linuxPids, [991]);
  assert.equal(probe.processes[0]?.cwd, "/home/spectral/.mlbb-copilot/training/full");
  assert.match(String(probe.processes[0]?.cmdline), /ultralyticsVision\.py train/);
  assert.equal(probe.processes[0]?.children[0]?.pid, 992);
  assert.match(String(probe.processes[0]?.children[0]?.cmdline), /pt_data_worker/);
});
