import assert from "node:assert/strict";
import { test } from "node:test";
import { adbRetryDelayMs, isRetryableAdbError, AdbCaptureError } from "../backend/src/services/adbFrameSource.ts";

test("adb retry delay uses exponential backoff with cap", () => {
  assert.equal(adbRetryDelayMs(1), 250);
  assert.equal(adbRetryDelayMs(2), 500);
  assert.equal(adbRetryDelayMs(3), 1000);
  assert.equal(adbRetryDelayMs(4), 2000);
  assert.equal(adbRetryDelayMs(8), 2000);
});

test("adb retry classification marks transient device failures as retryable", () => {
  assert.equal(isRetryableAdbError(new AdbCaptureError("no_device", "offline", "adb", true)), true);
  assert.equal(isRetryableAdbError(new AdbCaptureError("unauthorized", "blocked", "adb", false)), false);
  assert.equal(isRetryableAdbError(Object.assign(new Error("device offline"), { code: "ETIMEDOUT" })), true);
  assert.equal(isRetryableAdbError(new Error("unauthorized device")), false);
});
