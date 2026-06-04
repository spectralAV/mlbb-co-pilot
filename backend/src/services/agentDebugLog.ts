import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const LOG_PATH = path.resolve(process.cwd(), "..", ".cursor", "debug-agent.log");

export function isAgentDebugEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.MLBB_AGENT_DEBUG === "1";
}

export async function appendAgentDebugLog(payload: Record<string, unknown>) {
  if (!isAgentDebugEnabled()) return;
  await mkdir(path.dirname(LOG_PATH), { recursive: true });
  await appendFile(LOG_PATH, `${JSON.stringify({ ...payload, timestamp: Date.now() })}\n`);
}
