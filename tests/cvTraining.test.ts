import assert from "node:assert/strict";
import test from "node:test";
import { cpuTrainingBlocked, trainingDeviceLabel, trainingUnavailable } from "../frontend/src/utils/cvTraining";

test("CV training blocks PyTorch CPU devices", () => {
  assert.equal(cpuTrainingBlocked({ trainingDevice: { selected: "cpu", type: "cpu" } }), true);
  assert.equal(trainingDeviceLabel({ trainingDevice: { selected: "cpu", type: "cpu" } }), "Blocked");
});

test("CV training allows visible GPU devices", () => {
  assert.equal(cpuTrainingBlocked({ trainingDevice: { selected: "0", type: "rocm", name: "AMD GPU" } }), false);
  assert.equal(trainingDeviceLabel({ trainingDevice: { selected: "0", type: "rocm", name: "AMD GPU" } }), "ROCm training");
});

test("CV training reports unavailable training runtimes separately", () => {
  assert.equal(trainingUnavailable({ trainingDevice: { selected: "unavailable", type: "unavailable" } }), true);
});
