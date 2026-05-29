import type { FastifyInstance } from "fastify";
import { captureAdbPngFrame, getAdbCaptureStatus } from "../services/adbFrameSource.js";
import { getLatestNativeObsFrame, getNativeObsBridgeStatus, ingestNativeObsFrame } from "../services/nativeObsBridge.js";
import { attachScrcpyH264Client, getScrcpyStatus, startScrcpy, stopScrcpy } from "../services/scrcpySource.js";
import { getNativeObsUltralyticsStatus, queueNativeObsUltralyticsFrame } from "../vision/ultralyticsVision.js";
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
  app.addContentTypeParser("image/bmp", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.get("/api/coach/state", async () => getObsCoachState());
  app.post("/api/coach/state", async (req) => {
    setObsCoachState(req.body as any);
    return getObsCoachState();
  });

  app.get("/api/obs/status", async () => {
    const bridge = getNativeObsBridgeStatus();
    return {
      ok: true,
      realtime: getObsRealtime(),
      captureConnected: bridge.connected,
      bridge,
      ultralytics: getNativeObsUltralyticsStatus(),
      message: bridge.connected ? "Native OBS scrcpy source is feeding CV frames." : "Waiting for the native OBS scrcpy source CV bridge."
    };
  });

  app.post("/api/obs/start", async () => ({ ok: true, realtime: setObsRealtime(true), bridge: getNativeObsBridgeStatus(), message: "OBS overlay realtime enabled. Start the native scrcpy source with its CV bridge enabled to feed detected state." }));
  app.post("/api/obs/stop", async () => ({ ok: true, realtime: setObsRealtime(false), bridge: getNativeObsBridgeStatus(), message: "OBS overlay realtime stopped." }));
  app.get("/api/obs/frame", async (_req, reply) => sendNativeObsFrame(reply));
  app.get("/api/capture/obs/status", async () => ({ ok: true, bridge: getNativeObsBridgeStatus(), ultralytics: getNativeObsUltralyticsStatus() }));
  app.post("/api/capture/obs/frame", { bodyLimit: 32 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ ok: false, error: "Expected an image/bmp frame body." });
    const source = String(req.headers["x-mlbb-source"] ?? "obs-scrcpy-plugin");
    const status = ingestNativeObsFrame(req.body, source);
    const ultralytics = queueNativeObsUltralyticsFrame(req.body, source);
    return { ok: true, bridge: status, ultralytics };
  });
  app.get("/api/capture/obs/frame", async (_req, reply) => sendNativeObsFrame(reply));
  app.get("/api/capture/status", async () => getAdbCaptureStatus());
  app.get("/api/capture/scrcpy/status", async () => getScrcpyStatus());
  app.post("/api/capture/scrcpy/start", async (req, reply) => {
    try {
      const status = await startScrcpy(req.body);
      if (!status.ok) return reply.code(400).send({ ok: false, status, error: status.message });
      return { ok: true, status };
    } catch (error) {
      app.log.error({ error, body: req.body }, "scrcpy capture start failed");
      return reply.code(503).send({ ok: false, error: error instanceof Error ? error.message : "scrcpy capture start failed.", status: getScrcpyStatus() });
    }
  });
  app.post("/api/capture/scrcpy/stop", async () => {
    app.log.info("scrcpy capture stop requested");
    return { ok: true, status: stopScrcpy() };
  });
  app.get("/ws/capture/scrcpy-h264", { websocket: true }, (socket) => attachScrcpyH264Client(socket));
  app.get("/api/capture/frame", async (_req, reply) => {
    try {
      const frame = await captureAdbPngFrame();
      reply
        .header("cache-control", "no-store")
        .header("x-captured-at", frame.capturedAt)
        .header("x-capture-elapsed-ms", String(frame.elapsedMs))
        .type("image/png")
        .send(frame.buffer);
    } catch (error) {
      app.log.warn({ error }, "ADB frame capture failed");
      reply.code(503).send({ ok: false, error: error instanceof Error ? error.message : "ADB frame capture failed." });
    }
  });

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

function sendNativeObsFrame(reply: any) {
  const frame = getLatestNativeObsFrame();
  if (!frame) return reply.code(404).send({ ok: false, error: "No native OBS bridge frame has arrived yet." });
  return reply
    .header("cache-control", "no-store")
    .header("x-captured-at", frame.capturedAt)
    .header("x-source-width", String(frame.width))
    .header("x-source-height", String(frame.height))
    .type("image/bmp")
    .send(frame.buffer);
}
