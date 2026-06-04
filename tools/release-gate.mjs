/**
 * CI-parity pre-tag gate: debug ingest grep + build + test.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patterns = ["7242", "debug-session", "624fbe", "#region agent", ".cursor/debug-agent.log"];
const searchRoots = [
  path.join(root, "backend", "src"),
  path.join(root, "frontend", "src"),
];

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function runNpmScript(script) {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm", "run", script], {
          cwd: root,
          encoding: "utf8",
          stdio: "inherit",
          shell: false,
        })
      : spawnSync("npm", ["run", script], {
          cwd: root,
          encoding: "utf8",
          stdio: "inherit",
          shell: false,
        });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("Release gate: scanning for debug ingest markers...");
for (const dir of searchRoots) {
  const rg = spawnSync(npxCmd, ["--yes", "rg", "-n", patterns.join("|"), dir], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (rg.status === 0 && String(rg.stdout ?? "").trim()) {
    console.error("Release gate failed: debug markers found:\n", rg.stdout);
    process.exit(1);
  }
}

const grepOnly = process.argv.includes("--grep-only");

if (!grepOnly) {
  console.log("Release gate: npm run build");
  runNpmScript("build");
  console.log("Release gate: npm test");
  runNpmScript("test");
}
console.log("Release gate passed.");
