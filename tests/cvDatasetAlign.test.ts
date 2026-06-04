import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.platform === "win32"
  ? path.join(root, "data", "cv", ".venv", "Scripts", "python.exe")
  : "python";

function run(script: string, flag: string) {
  return execFileSync(python, [path.join(root, "backend", "tools", script), flag], {
    cwd: root,
    encoding: "utf8",
  });
}

test("cvLayoutProfiles self-test", () => {
  const out = run("cvLayoutProfiles.py", "--test");
  assert.match(out, /"ok": true/);
});

test("cvDatasetAlign relabels square draft boxes to slot rails", () => {
  const out = run("cvDatasetAlign.py", "--test");
  assert.match(out, /"ok": true/);
});
