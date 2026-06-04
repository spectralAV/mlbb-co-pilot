import assert from "node:assert/strict";
import { test } from "node:test";
import { getDraftBannerModelStatus } from "../backend/src/vision/draftBannerModel.ts";

test("getDraftBannerModelStatus reports availability shape", async () => {
  const status = await getDraftBannerModelStatus();
  assert.equal(typeof status.available, "boolean");
  if (status.available) {
    assert.ok((status.model?.references?.length ?? 0) > 0);
    const ref = status.model?.references?.[0];
    assert.ok(ref?.signature?.length === 600, "banner signature grid is 30x20");
  }
});
