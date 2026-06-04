/**
 * CI-parity pre-tag gate: debug ingest grep + build + test.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patterns = ["7242", "debug-session", "624fbe", "#region agent", ".cursor/debug-agent.log"];
const searchRoots = [
  path.join(root, "backend", "src"),
  path.join(root, "frontend", "src"),
];

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

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function scanDebugMarkers() {
  const findings = [];
  for (const dir of searchRoots) {
    for (const file of walkFiles(dir)) {
      let text = "";
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        for (const pattern of patterns) {
          if (line.includes(pattern)) {
            findings.push(`${path.relative(root, file)}:${index + 1}: ${pattern}`);
          }
        }
      }
    }
  }
  return findings;
}

console.log("Release gate: scanning for debug ingest markers...");
const debugFindings = scanDebugMarkers();
if (debugFindings.length) {
  console.error("Release gate failed: debug markers found:\n", debugFindings.join("\n"));
  process.exit(1);
}

const grepOnly = process.argv.includes("--grep-only");

if (!grepOnly) {
  console.log("Release gate: npm run build");
  runNpmScript("build");
  console.log("Release gate: npm test");
  runNpmScript("test");
}
console.log("Release gate passed.");
