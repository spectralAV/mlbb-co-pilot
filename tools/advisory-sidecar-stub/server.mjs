/**
 * Dev-only advisory sidecar stub. POST /advise mirrors heuristic-style output.
 *
 *   node tools/advisory-sidecar-stub/server.mjs
 *   ADVISORY_COACH_PROVIDER=llm-sidecar
 *   ADVISORY_SIDECAR_URL=http://127.0.0.1:8790/advise
 */
import http from "node:http";

const port = Number(process.env.ADVISORY_SIDECAR_PORT ?? 8790);

function advise(body) {
  const decision = body?.decision ?? {};
  const ruleId = decision.ruleId ?? "stable_state";
  const action = decision.recommendedAction ?? "Hold and gather information.";
  return {
    status: "ready",
    advisorId: "advisory-sidecar-stub",
    groundedRuleId: ruleId,
    reasoning: `Sidecar stub grounded on ${ruleId}.`,
    recommendations: [
      { id: "sidecar-1", title: "Sidecar note", action, horizon: "immediate" },
      { id: "sidecar-2", title: "Map discipline", action: "Sweep river vision before committing.", horizon: "short" },
    ],
    macroNotes: ["Stub sidecar — replace with NPU/LLM backend in production."],
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "advisory-sidecar-stub" }));
    return;
  }
  if (req.method === "POST" && (req.url === "/advise" || req.url === "/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, data: advise(body) }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Advisory sidecar stub listening on http://127.0.0.1:${port}`);
});
