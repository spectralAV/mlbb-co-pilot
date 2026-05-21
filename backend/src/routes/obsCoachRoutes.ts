import type { FastifyInstance } from "fastify";
import {
  addObsRegion,
  clearObsRegions,
  getObsCoachState,
  getObsConfig,
  getObsRealtime,
  getObsRegions,
  saveObsConfig,
  saveObsRegions,
  setObsCoachState,
  setObsRealtime
} from "../services/obsCoachState.js";

function isRegion(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
}

export async function obsCoachRoutes(app: FastifyInstance) {
  app.get("/api/coach/state", async () => getObsCoachState());
  app.post("/api/coach/state", async (req) => {
    setObsCoachState(req.body as any);
    return getObsCoachState();
  });

  app.get("/api/obs/status", async () => ({
    ok: true,
    realtime: getObsRealtime(),
    captureConnected: false,
    message: "OBS capture adapter prepared; live source reading is not connected in this TypeScript build."
  }));

  app.post("/api/obs/start", async () => ({ ok: true, realtime: setObsRealtime(true), message: "OBS realtime flag enabled. Capture adapter is still manual/prepared." }));
  app.post("/api/obs/stop", async () => ({ ok: true, realtime: setObsRealtime(false), message: "OBS realtime stopped." }));
  app.get("/api/obs/frame", async (_req, reply) => reply.code(404).send({ ok: false, error: "No OBS frame source is connected yet." }));

  app.get("/api/obs/regions", async () => getObsRegions());
  app.post("/api/obs/regions", async (req) => ({ ok: true, regions: await saveObsRegions(req.body) }));
  app.post("/api/obs/regions/add", async (req, reply) => {
    const body = req.body as any;
    if (!body?.key || !isRegion(body.region)) return reply.code(400).send({ ok: false, error: "Need key and normalized region [x,y,w,h]." });
    return { ok: true, key: body.key, region: body.region, regions: await addObsRegion(body.key, body.region) };
  });
  app.post("/api/obs/regions/clear", async (req) => {
    const key = String((req.body as any)?.key ?? "all");
    return { ok: true, regions: await clearObsRegions(key) };
  });

  app.get("/api/obs/config", async () => getObsConfig());
  app.post("/api/obs/config", async (req) => ({ ok: true, config: await saveObsConfig(req.body) }));
}
