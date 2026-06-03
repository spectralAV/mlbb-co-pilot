import type { FastifyInstance } from "fastify";
import { AdbCaptureError, captureAdbPngFrame, getAdbCaptureStatus } from "../services/adbFrameSource.js";
import { getLatestNativeObsFrame, getNativeObsBridgeStatus, ingestNativeObsFrame, ingestNativeObsRawFrame } from "../services/nativeObsBridge.js";
import { attachScrcpyH264Client, getScrcpyStatus, startScrcpy, stopScrcpy } from "../services/scrcpySource.js";
import { getNativeObsUltralyticsStatus, queueNativeObsUltralyticsFrame } from "../vision/ultralyticsVision.js";
import { getNdiToolsStatus, launchNdiTool } from "../services/ndiTools.js";
import { attachNdiDirectRawClient, getLatestNdiDirectFrame, getLatestNdiDirectRawFrame, getNdiDirectStatus, listNdiDirectSources, startNdiDirectCapture, stopNdiDirectCapture, waitForNextNdiDirectRawFrame } from "../services/ndiDirectSource.js";
import { getObsScrcpyPluginStatus, installObsScrcpyPlugin } from "../services/obsPluginInstaller.js";
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
  app.addContentTypeParser("application/vnd.mlbb.raw-frame", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

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
  app.get("/api/capture/obs/plugin/status", async () => getObsScrcpyPluginStatus());
  app.post("/api/capture/obs/plugin/install", async (_req, reply) => {
    const result = await installObsScrcpyPlugin();
    if (!result.obsInstalled || !result.bundled || result.error) return reply.code(400).send(result);
    return result;
  });
  app.get("/api/capture/ndi/status", async () => getNdiToolsStatus());
  app.get("/api/capture/ndi/direct/status", async () => getNdiDirectStatus());
  app.get("/api/capture/ndi/direct/sources", async () => listNdiDirectSources());
  app.post("/api/capture/ndi/direct/start", async (req, reply) => {
    const body = req.body as any;
    const result = await startNdiDirectCapture({ sourceName: body?.sourceName, sourceUrl: body?.sourceUrl, maxFps: body?.maxFps });
    if (!result.ok) return reply.code(400).send(result);
    return result;
  });
  app.post("/api/capture/ndi/direct/stop", async () => ({ ok: true, status: stopNdiDirectCapture() }));
  app.get("/api/capture/ndi/direct/frame.raw", async (req, reply) => {
    const query = req.query as { after?: string };
    const after = query.after ? String(query.after) : "";
    const frame = after ? await waitForNextNdiDirectRawFrame(after, 120) : getLatestNdiDirectRawFrame();
    if (!frame) {
      if (after && getLatestNdiDirectRawFrame()) {
        return reply
          .code(204)
          .header("cache-control", "no-store")
          .send();
      }
      return reply.code(404).send({ ok: false, error: "No direct NDI frame has arrived yet." });
    }
    if (after && after === frame.frameId) {
      return reply
        .code(204)
        .header("cache-control", "no-store")
        .header("x-frame-id", frame.frameId)
        .send();
    }
    return reply
      .header("cache-control", "no-store")
      .header("x-captured-at", frame.capturedAt)
      .header("x-frame-id", frame.frameId)
      .header("x-source-width", String(frame.width))
      .header("x-source-height", String(frame.height))
      .header("x-fourcc", frame.fourCc)
      .type("application/octet-stream")
      .send(frame.buffer);
  });
  app.get("/api/capture/ndi/direct/frame", async (_req, reply) => {
    const frame = await getLatestNdiDirectFrame();
    if (!frame) return reply.code(404).send({ ok: false, error: "No direct NDI frame has arrived yet." });
    return reply
      .header("cache-control", "no-store")
      .header("x-captured-at", frame.capturedAt)
      .header("x-frame-id", frame.frameId)
      .header("x-source-width", String(frame.width))
      .header("x-source-height", String(frame.height))
      .type("image/png")
      .send(frame.buffer);
  });
  app.get("/ws/capture/ndi-direct-raw", { websocket: true }, (socket) => attachNdiDirectRawClient(socket));
  app.post("/api/capture/ndi/launch", async (req, reply) => {
    const tool = String((req.body as any)?.tool ?? "studioMonitor") as any;
    const result = await launchNdiTool(tool);
    if (!result.ok) return reply.code(404).send(result);
    return result;
  });
  app.post("/api/capture/obs/frame.raw", { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ ok: false, error: "Expected a raw video frame body." });
    const source = String(req.headers["x-mlbb-source"] ?? "obs-scrcpy-plugin");
    const width = Number(req.headers["x-source-width"] ?? 0);
    const height = Number(req.headers["x-source-height"] ?? 0);
    const pixelFormat = String(req.headers["x-pixel-format"] ?? "");
    const status = ingestNativeObsRawFrame(req.body, { width, height, pixelFormat }, source);
    const frame = getLatestNativeObsFrame();
    if (frame?.kind === "raw") queueNativeObsUltralyticsFrame(frame, source);
    return reply.code(202).send({ ok: true, receivedFrames: status.receivedFrames, pixelFormat: status.pixelFormat });
  });
  app.post("/api/capture/obs/frame", { bodyLimit: 32 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ ok: false, error: "Expected an image/bmp frame body." });
    const source = String(req.headers["x-mlbb-source"] ?? "obs-scrcpy-plugin");
    const status = ingestNativeObsFrame(req.body, source);
    queueNativeObsUltralyticsFrame(req.body, source);
    return reply.code(202).send({ ok: true, receivedFrames: status.receivedFrames });
  });
  app.get("/api/capture/obs/frame.raw", async (_req, reply) => sendNativeObsRawFrame(reply));
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
      const code = error instanceof AdbCaptureError ? error.code : "capture_failed";
      reply.code(503).send({
        ok: false,
        code,
        error: error instanceof Error ? error.message : "ADB frame capture failed.",
        status: await getAdbCaptureStatus(),
      });
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
  if (frame.kind === "raw") return sendNativeObsRawFrame(reply);
  return reply
    .header("cache-control", "no-store")
    .header("x-captured-at", frame.capturedAt)
    .header("x-source-width", String(frame.width))
    .header("x-source-height", String(frame.height))
    .type("image/bmp")
    .send(frame.buffer);
}

function sendNativeObsRawFrame(reply: any) {
  const frame = getLatestNativeObsFrame();
  if (!frame) return reply.code(404).send({ ok: false, error: "No native OBS raw frame has arrived yet." });
  if (frame.kind !== "raw") return reply.code(409).send({ ok: false, error: "Latest OBS bridge frame is encoded, not raw." });
  return reply
    .header("cache-control", "no-store")
    .header("x-captured-at", frame.capturedAt)
    .header("x-source-width", String(frame.width))
    .header("x-source-height", String(frame.height))
    .header("x-pixel-format", frame.pixelFormat)
    .type("application/octet-stream")
    .send(frame.buffer);
}
