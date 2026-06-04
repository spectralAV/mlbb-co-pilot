import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSlotGeometrySource } from "../frontend/src/vision/draftYoloSlots.ts";

test("resolveSlotGeometrySource prefers yolo when rect matches yolo box", () => {
  const defaultRect: [number, number, number, number] = [0.1, 0.2, 0.05, 0.08];
  const yoloRect: [number, number, number, number] = [0.11, 0.21, 0.06, 0.09];
  assert.equal(resolveSlotGeometrySource(yoloRect, defaultRect, yoloRect), "yolo");
});

test("resolveSlotGeometrySource marks calibrated when rect differs from default", () => {
  const defaultRect: [number, number, number, number] = [0.1, 0.2, 0.05, 0.08];
  const calibratedRect: [number, number, number, number] = [0.12, 0.22, 0.05, 0.08];
  assert.equal(resolveSlotGeometrySource(calibratedRect, defaultRect, undefined), "calibrated");
});

test("resolveSlotGeometrySource falls back to default", () => {
  const defaultRect: [number, number, number, number] = [0.1, 0.2, 0.05, 0.08];
  assert.equal(resolveSlotGeometrySource(defaultRect, defaultRect, undefined), "default");
});
