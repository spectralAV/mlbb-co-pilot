import assert from "node:assert/strict";
import { test } from "node:test";
import { isDuplicateSessionEvent } from "../frontend/src/lib/gameSessionStore.ts";

test("CV session event dedupe suppresses repeated identical observations only", () => {
  const base = {
    id: "cv-death-1",
    timestamp: 10_000,
    type: "death" as const,
    label: "CV Death Replay",
    source: "cv" as const,
    confidence: "high" as const,
  };

  assert.equal(isDuplicateSessionEvent(base, { ...base, id: "cv-death-2", timestamp: 15_000 }), true);
  assert.equal(isDuplicateSessionEvent(base, { ...base, id: "cv-death-3", timestamp: 25_000 }), false);
  assert.equal(isDuplicateSessionEvent(base, { ...base, id: "cv-fight", type: "fight_lost", label: "CV Fight Lost" }), false);
  assert.equal(isDuplicateSessionEvent({ ...base, source: "manual" }, { ...base, id: "manual-2", source: "manual" }), false);
});
