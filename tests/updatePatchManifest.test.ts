import assert from "node:assert/strict";
import { test } from "node:test";
import { PatchManifestSchema } from "../backend/src/updates/validatePatch.ts";

test("CV module manifests require cvModule metadata", () => {
  assert.throws(
    () => PatchManifestSchema.parse({ name: "trial", version: "0.1.0", type: "cv-module" }),
    /CV module ZIPs must include a cvModule manifest block/,
  );
});

test("CV module manifests accept declared vision surfaces", () => {
  const manifest = PatchManifestSchema.parse({
    name: "minimap-trial",
    version: "0.1.0",
    type: "cv-module",
    cvModule: {
      id: "roboflow-minimap-2",
      displayName: "Roboflow Minimap Trial",
      surfaces: ["minimap"],
      experiments: ["roboflow-minimap-2"],
      entrypoints: { docs: "data/cv/roboflow-minimap-2/README.md" },
    },
  });

  assert.equal(manifest.type, "cv-module");
  assert.equal(manifest.cvModule?.risk, "experimental");
  assert.deepEqual(manifest.cvModule?.surfaces, ["minimap"]);
});
