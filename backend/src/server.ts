import Fastify from "fastify";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { FRONTEND_PORT, HOST, LOCAL_DNS_HOSTNAMES, PORT } from "./config.js";
import { cache } from "./services/cacheService.js";
import { semanticRegistry } from "./services/semanticRegistry.js";
import { mlbbIo } from "./services/mlbbIoService.js";
import { semanticRoutes } from "./routes/semanticRoutes.js";
import { buildHeroRoutes } from "./routes/buildHeroRoutes.js";
import { overlayRoutes } from "./routes/overlayRoutes.js";
import { obsCoachRoutes } from "./routes/obsCoachRoutes.js";
import { draftSimulatorRoutes } from "./routes/draftSimulatorRoutes.js";
import { draftFeedbackRoutes } from "./routes/draftFeedbackRoutes.js";
import { videoReviewRoutes } from "./routes/videoReviewRoutes.js";
import { roneRoutes } from "./routes/roneRoutes.js";
import { setupRoutes } from "./routes/setupRoutes.js";
import { runtimeRoutes } from "./routes/runtimeRoutes.js";
import { syncRoutes } from "./routes/syncRoutes.js";
import { updateRoutes } from "./routes/updateRoutes.js";
import { analyzeDraft } from "./engines/draftEngine.js";
import { analyzeBuild } from "./engines/buildEngine.js";
import { suggestHeroSynergies } from "./engines/synergyEngine.js";
import { eventBus } from "./event-bus/eventBus.js";
import { getMapRuntimeManifest, getMinimapProjection, getZones, mapPointToZone, projectMinimapPoint, saveMinimapProjection, saveZones } from "./map-runtime/mapRuntime.js";
import { installModule, listModules, sdkDescription } from "./module-runtime/moduleRuntime.js";
import { getLatestDraftRecognition, ingestDraftRecognition } from "./vision/draftRecognition.js";
import { getHeroRecognitionManifest, getHeroRecognitionReference, heroRecognitionScenes } from "./vision/heroRecognition.js";
import { getLaneRecognitionManifest, getLaneRecognitionReference } from "./vision/laneRecognition.js";
import { compileSkinPortraitSignatures, fetchSkinPortrait, getSkinPortraitManifest, getSkinSignatureManifest, getSkinSignatureStatus, syncSkinPortraitManifest } from "./vision/skinPortraitRecognition.js";
import { getLatestLiveVision, getLatestLiveVisionObservation, ingestLiveVisionFrame, parseLiveVisionFrameInput } from "./vision/liveVisionState.js";
import { getScreenStateModel, getScreenStateTrainingStatus, trainScreenStateModel } from "./vision/screenStateTraining.js";
import { ensureDraftBannerModel, getDraftBannerModel, getDraftBannerModelStatus, trainDraftBannerModel } from "./vision/draftBannerModel.js";
import { getDraftHeroModel, getDraftHeroModelStatus, trainDraftHeroModel } from "./vision/draftHeroModelTraining.js";
import { getLatestAdvisoryCoach } from "./engines/advisoryCoachLane.js";
import { getLatestLiveReasoning, ingestLiveReasoning, listCoachReasoningScenarios } from "./engines/liveReasoningEngine.js";
import { getMatchState } from "./state/matchState.js";
import { getPlayerProfile, savePlayerProfile } from "./services/playerProfile.js";
import { getBattleSpellRecognitionManifest, getBattleSpellRecognitionReference } from "./vision/battleSpellRecognition.js";
import { getEquipmentRecognitionManifest, getEquipmentRecognitionReference } from "./vision/equipmentRecognition.js";
import { getUltralyticsStatus, inferUltralyticsFrame, installUltralyticsRuntime, mapUltralyticsMinimapMarkers, mapUltralyticsMinimapObjects } from "./vision/ultralyticsVision.js";
import { getCvDatasetQuality } from "./services/cvDatasetQuality.js";
import { probeAdvisorySidecarHealth } from "./engines/llmSidecarAdvisoryCoach.js";
import {
  exportUltralyticsOnnx,
  getUltralyticsTrainingStatus,
  rehydrateUltralyticsTrainingJob,
  startUltralyticsTrainingJob,
  stopUltralyticsTrainingJob,
} from "./vision/ultralyticsTrainingJob.js";
import { firstNormalizedRegion, getActiveObsRegions } from "./services/obsCoachState.js";
import { readMlbbAdbHeroHead, readMlbbAdbTexture } from "./services/mlbbAdbAssets.js";
import { annotationImage, deleteAnnotation, getAnnotation, getAnnotationClasses, listAnnotations, saveAnnotation, syncSavedAnnotationsToDataset, updateAnnotation } from "./vision/cvAnnotation.js";
import { getDinoIdentityStatus, indexDinoReferences, matchDinoIdentity } from "./vision/dinoIdentity.js";
import { getTimerOcrStatus, inferTimerCrop, installTimerOcrRuntime, timerClasses } from "./vision/timerRecognition.js";
import { getMlbbHudOcrFeedStatus, getScreenOcrStatus, inferScreenTextFrame, installScreenOcrRuntime, normalizeScreenOcrRegions } from "./vision/screenTextRecognition.js";
import { getVisionReflectionSummary } from "./vision/visionReflection.js";
import { addClientPerformanceSample, getPerformanceSnapshot, recordRequestMetric } from "./services/performanceMonitor.js";
import { ensureObsScrcpyPluginInstalled } from "./services/obsPluginInstaller.js";
import { appendAgentDebugLog, isAgentDebugEnabled } from "./services/agentDebugLog.js";

const app = Fastify({ logger: true });
const frontendDist = path.resolve(process.cwd(), "..", "frontend", "dist");
const frontendAssets = path.join(frontendDist, "assets");
const frontendIndex = path.join(frontendDist, "index.html");

process.on("unhandledRejection", (reason) => {
  app.log.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  app.log.fatal({ error }, "Uncaught exception");
});

const allowedCorsOrigins = new Set([
  `http://localhost:${FRONTEND_PORT}`,
  `http://127.0.0.1:${FRONTEND_PORT}`,
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...LOCAL_DNS_HOSTNAMES.flatMap((hostname) => [
    `http://${hostname}`,
    `http://${hostname}:${FRONTEND_PORT}`,
    `http://${hostname}:${PORT}`
  ])
]);

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS origin not allowed: ${origin}`), false);
  }
});
await app.register(multipart);
await app.register(websocket);
await app.register(semanticRoutes);
await app.register(buildHeroRoutes);
await app.register(syncRoutes);
await app.register(roneRoutes);
await app.register(setupRoutes);
await app.register(runtimeRoutes);
await app.register(updateRoutes);
await app.register(overlayRoutes);
await app.register(obsCoachRoutes);
await app.register(draftSimulatorRoutes);
await app.register(draftFeedbackRoutes);
await app.register(videoReviewRoutes);

app.addHook("onRequest", async (request) => {
  (request as any).performanceStartedAt = performance.now();
});

app.addHook("onResponse", async (request, reply) => {
  const startedAt = Number((request as any).performanceStartedAt ?? performance.now());
  recordRequestMetric(request.method, request.url, reply.statusCode, performance.now() - startedAt);
});

if (isAgentDebugEnabled()) {
  app.post("/api/debug/agent-log", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    await appendAgentDebugLog(body);
    return { ok: true };
  });
}

async function fileExists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function registerFrontendStatic() {
  if (!await fileExists(frontendIndex)) return;
  await app.register(staticPlugin, { root: frontendAssets, prefix: "/assets/" });

  app.get("/*", async (req, reply) => {
    const pathname = (req.raw.url ?? "").split("?")[0] ?? "";
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/ws" || pathname.startsWith("/ws/")) {
      return reply.code(404).send({ ok: false, error: "Route not found." });
    }
    if (path.extname(pathname)) return reply.code(404).send({ ok: false, error: "Asset not found." });
    return reply.type("text/html; charset=utf-8").send(await readFile(frontendIndex, "utf8"));
  });
}

app.get("/api/health", async () => ({ ok: true, service: "MLBB Co-Pilot", time: new Date().toISOString() }));
app.get("/api/performance/snapshot", async () => getPerformanceSnapshot());
app.post("/api/performance/client", async (req) => {
  addClientPerformanceSample(req.body as any, req.headers["user-agent"]);
  return { success: true };
});
app.post("/api/sync/all", async () => { const result = await mlbbIo.syncAll(); eventBus.emit("data_synced", result); return { success:true, result }; });
app.get("/api/sync/all", async () => { const result = await mlbbIo.syncAll(); eventBus.emit("data_synced", result); return { success:true, result }; });
app.post("/api/sync/heroes", async () => ({ success:true, data: await mlbbIo.syncHeroes() }));
app.post("/api/sync/items", async () => ({ success:true, data: await mlbbIo.syncItems() }));
app.post("/api/sync/emblems", async () => ({ success:true, data: await mlbbIo.syncEmblems() }));
app.post("/api/sync/talents", async () => ({ success:true, data: await mlbbIo.syncTalents() }));

app.get("/api/cache/:name", async (req) => { const { name } = req.params as {name:string}; const allowed = new Set(["heroes","items","emblems","talents","tiers","builds","compiled-items","compiled-heroes","compiled-talents","metadata"]); if(!allowed.has(name)) return {success:false,error:"Unknown cache"}; return {success:true,data: await cache.read(`${name}.json`, [])}; });
app.get("/api/cache/metadata", async () => ({ success:true, data: await cache.read("metadata.json", {}) }));

app.post("/api/draft/analyze", async (req) => { const result = await analyzeDraft(req.body as any); eventBus.emit("draft_updated", result); return {success:true,data:result}; });
app.get("/api/profile", async () => ({ success: true, data: await getPlayerProfile() }));
app.post("/api/profile", async (req) => ({ success: true, data: await savePlayerProfile(req.body as any) }));
app.post("/api/draft/recommend", async (req) => { const body=req.body as any; return {success:true,data: await mlbbIo.combinedRecommendations(body.allyHeroes??[], body.enemyHeroes??[])}; });
app.post("/api/draft/counters", async (req) => { const body=req.body as any; return {success:true,data: await mlbbIo.counterPickSuggestions(body.enemyHeroes??[])}; });
app.post("/api/draft/synergy", async (req) => { const body=req.body as any; const heroes = await cache.read<any[]>("compiled-heroes.json", []); const fallback = heroes.length ? heroes : await cache.read<any[]>("heroes.json", []); return {success:true,data:suggestHeroSynergies(fallback, body.allyHeroes??[], { lane: body.lane, role: body.role }).slice(0, 12)}; });
app.post("/api/build/analyze", async (req) => { const body=req.body as any; return {success:true,data: await analyzeBuild(body.heroId, body.enemyHeroIds??[])}; });
app.get("/api/registry/overview", async () => ({ success:true, data: await semanticRegistry.overview() }));
app.get("/api/vision/heroes/manifest", async () => ({ success:true, data: await getHeroRecognitionManifest() }));
app.get("/api/vision/heroes/icon/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const hero = Number.isFinite(id) ? await getHeroRecognitionReference(id) : null;
  if (!hero) return reply.code(404).send({ success: false, error: "Unknown hero reference" });
  const image = await fetch(hero.iconUrl);
  if (!image.ok) return reply.code(502).send({ success: false, error: "Hero reference unavailable" });
  const data = Buffer.from(await image.arrayBuffer());
  return reply
    .header("cache-control", "public, max-age=86400")
    .type(image.headers.get("content-type") ?? "image/png")
    .send(data);
});
app.get("/api/vision/heroes/draft-head/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const image = Number.isFinite(id) ? await readMlbbAdbHeroHead(id) : null;
  if (!image) return reply.code(404).send({ success: false, error: "ADB draft head reference unavailable" });
  return reply
    .header("cache-control", "private, max-age=3600")
    .type("image/png")
    .send(image);
});
app.get("/api/vision/heroes/portrait/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const hero = Number.isFinite(id) ? await getHeroRecognitionReference(id) : null;
  if (!hero?.portraitUrl) return reply.code(404).send({ success: false, error: "Unknown hero portrait reference" });
  const image = await fetch(hero.portraitUrl);
  if (!image.ok) return reply.code(502).send({ success: false, error: "Hero portrait unavailable" });
  const data = Buffer.from(await image.arrayBuffer());
  return reply
    .header("cache-control", "public, max-age=86400")
    .type(image.headers.get("content-type") ?? "image/png")
    .send(data);
});
app.get("/api/vision/skins/manifest", async () => ({ success: true, data: await getSkinPortraitManifest() }));
app.post("/api/vision/skins/sync", async () => ({ success: true, data: await syncSkinPortraitManifest() }));
app.get("/api/vision/skins/signatures/status", async () => ({ success: true, data: await getSkinSignatureStatus() }));
app.get("/api/vision/skins/signatures", async () => ({ success: true, data: await getSkinSignatureManifest() }));
app.post("/api/vision/skins/signatures/compile", async () => {
  await compileSkinPortraitSignatures();
  return { success: true, data: await getSkinSignatureStatus() };
});
app.get("/api/vision/skins/portrait/:heroId/:skinId", async (req, reply) => {
  const { heroId, skinId } = req.params as { heroId: string; skinId: string };
  const image = await fetchSkinPortrait(Number(heroId), skinId);
  if (!image) return reply.code(404).send({ success: false, error: "Unknown skin portrait reference" });
  return reply
    .header("cache-control", "public, max-age=86400")
    .type(image.contentType)
    .send(image.data);
});
app.get("/api/vision/lanes/manifest", async () => ({ success:true, data: await getLaneRecognitionManifest() }));
app.get("/api/vision/lanes/icon/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const lane = Number.isFinite(id) ? getLaneRecognitionReference(id) : null;
  if (!lane) return reply.code(404).send({ success: false, error: "Unknown lane reference" });
  const data = await readMlbbAdbTexture(lane.texture);
  if (!data) return reply.code(404).send({ success: false, error: "ADB lane reference unavailable" });
  return reply
    .header("cache-control", "private, max-age=3600")
    .type("image/png")
    .send(data);
});
app.get("/api/vision/spells/manifest", async () => ({ success: true, data: getBattleSpellRecognitionManifest() }));
app.get("/api/vision/spells/icon/:id", async (req, reply) => {
  const spell = getBattleSpellRecognitionReference((req.params as { id: string }).id);
  if (!spell) return reply.code(404).send({ success: false, error: "Unknown battle spell reference" });
  const data = await readMlbbAdbTexture(spell.texture);
  if (!data) return reply.code(404).send({ success: false, error: "ADB battle spell reference unavailable" });
  return reply
    .header("cache-control", "private, max-age=3600")
    .type("image/png")
    .send(data);
});
app.get("/api/vision/equipment/manifest", async () => ({ success: true, data: getEquipmentRecognitionManifest() }));
app.get("/api/vision/equipment/icon/:id", async (req, reply) => {
  const item = getEquipmentRecognitionReference(Number((req.params as { id: string }).id));
  if (!item) return reply.code(404).send({ success: false, error: "Unknown equipment reference" });
  const data = await readMlbbAdbTexture(item.texture);
  if (!data) return reply.code(404).send({ success: false, error: "ADB equipment reference unavailable" });
  return reply
    .header("cache-control", "private, max-age=3600")
    .type("image/png")
    .send(data);
});
app.get("/api/vision/scenes", async () => ({ success:true, data: heroRecognitionScenes }));
app.get("/api/vision/draft/latest", async () => ({ success:true, data:getLatestDraftRecognition() }));
app.post("/api/vision/draft/recognition", async (req) => {
  const body = req.body as any;
  return { success: true, data: await ingestDraftRecognition(body) };
});
app.get("/api/vision/live/latest", async () => ({ success:true, data:getLatestLiveVision() }));
app.get("/api/vision/live/observation", async () => ({ success:true, data:getLatestLiveVisionObservation() }));
app.post("/api/vision/live/frame", async (req, reply) => {
  try {
    return { success:true, data:ingestLiveVisionFrame(parseLiveVisionFrameInput(req.body)) };
  } catch (error) {
    return reply.code(400).send({ success:false, error: error instanceof Error ? error.message : "Invalid live vision frame." });
  }
});
app.get("/api/vision/reflections", async (req) => {
  const limit = Number((req.query as { limit?: string })?.limit ?? 50);
  return { success: true, data: await getVisionReflectionSummary(limit) };
});
app.get("/api/vision/models/screen-state", async () => ({ success: true, data: await getScreenStateModel() }));
app.get("/api/vision/models/screen-state/status", async () => ({ success: true, data: await getScreenStateTrainingStatus() }));
app.post("/api/vision/models/screen-state/train", async (_req, reply) => {
  try {
    return { success: true, data: await trainScreenStateModel() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "CV screen-state training failed" });
  }
});
app.get("/api/vision/models/draft-heroes", async () => ({ success: true, data: await getDraftHeroModel() }));
app.get("/api/vision/models/draft-heroes/status", async () => ({ success: true, data: await getDraftHeroModelStatus() }));
app.post("/api/vision/models/draft-heroes/train", async (_req, reply) => {
  try {
    return { success: true, data: await trainDraftHeroModel() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Draft hero training failed" });
  }
});
app.get("/api/vision/models/draft-banners", async () => ({ success: true, data: await ensureDraftBannerModel() }));
app.get("/api/vision/models/draft-banners/status", async () => ({ success: true, data: await getDraftBannerModelStatus() }));
app.post("/api/vision/models/draft-banners/train", async (_req, reply) => {
  try {
    return { success: true, data: await trainDraftBannerModel() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Draft banner training failed" });
  }
});
app.get("/api/vision/models/ultralytics/status", async () => ({ success: true, data: await getUltralyticsStatus() }));
app.get("/api/vision/annotations/classes", async () => ({ success: true, data: getAnnotationClasses() }));
app.get("/api/vision/annotations", async () => ({ success: true, data: await listAnnotations() }));
app.get("/api/vision/annotations/:id/image", async (req, reply) => {
  const file = await annotationImage((req.params as { id: string }).id);
  if (!file) return reply.code(404).send({ success: false, error: "Annotation image not found." });
  return reply.header("cache-control", "no-store").type("image/jpeg").send(await readFile(file));
});
app.get("/api/vision/annotations/:id", async (req, reply) => {
  const sample = await getAnnotation((req.params as { id: string }).id);
  return sample ? { success: true, data: sample } : reply.code(404).send({ success: false, error: "Annotation not found." });
});
app.delete("/api/vision/annotations/:id", async (req, reply) => {
  const deleted = await deleteAnnotation((req.params as { id: string }).id);
  return deleted ? { success: true } : reply.code(404).send({ success: false, error: "Annotation not found." });
});
app.put("/api/vision/annotations/:id", async (req, reply) => {
  try {
    const sample = await updateAnnotation((req.params as { id: string }).id, req.body as any);
    return sample ? { success: true, data: sample } : reply.code(404).send({ success: false, error: "Annotation not found." });
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Annotation update failed." });
  }
});
app.post("/api/vision/annotations/sync", async () => ({ success: true, data: { samples: await syncSavedAnnotationsToDataset() } }));
app.post("/api/vision/annotations", async (req, reply) => {
  try {
    let frame: Buffer | null = null;
    let metadata: any = {};
    for await (const part of (req as any).parts({ limits: { fileSize: 32 * 1024 * 1024, files: 1, fields: 2 } })) {
      if (part.type === "file") frame = await part.toBuffer();
      if (part.type === "field" && part.fieldname === "metadata") metadata = JSON.parse(String(part.value));
    }
    if (!frame) return reply.code(400).send({ success: false, error: "A captured frame is required." });
    return { success: true, data: await saveAnnotation(frame, metadata) };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Annotation save failed." });
  }
});
app.post("/api/vision/models/ultralytics/install", async (_req, reply) => {
  try {
    return { success: true, data: await installUltralyticsRuntime() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Ultralytics installation failed" });
  }
});
app.get("/api/vision/models/ultralytics/training/status", async () => ({ success: true, data: getUltralyticsTrainingStatus() }));
app.post("/api/vision/models/ultralytics/training/start", async (req, reply) => {
  try {
    return { success: true, data: await startUltralyticsTrainingJob(req.body as any) };
  } catch (error) {
    return reply.code(409).send({ success: false, error: error instanceof Error ? error.message : "Could not start training" });
  }
});
app.post("/api/vision/models/ultralytics/training/stop", async (req, reply) => {
  try {
    return { success: true, data: await stopUltralyticsTrainingJob() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Could not stop training" });
  }
});
app.post("/api/vision/models/ultralytics/training/export-onnx", async (_req, reply) => {
  try {
    return { success: true, data: await exportUltralyticsOnnx() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "ONNX export failed" });
  }
});
/** @deprecated Use POST /api/vision/models/ultralytics/training/start and poll GET .../training/status. */
app.post("/api/vision/models/ultralytics/train", async (req, reply) => {
  req.log.warn("Deprecated POST /api/vision/models/ultralytics/train — use /training/start + /training/status");
  try {
    const job = await startUltralyticsTrainingJob(req.body as any);
    return {
      success: true,
      deprecated: true,
      message: "Training started asynchronously. Poll GET /api/vision/models/ultralytics/training/status.",
      data: job,
    };
  } catch (error) {
    return reply.code(409).send({ success: false, error: error instanceof Error ? error.message : "Could not start training" });
  }
});
app.get("/api/cv/dataset/quality", async () => ({ success: true, data: await getCvDatasetQuality() }));
app.get("/api/reasoning/advisory/sidecar-health", async () => ({ success: true, data: await probeAdvisorySidecarHealth() }));
app.post("/api/vision/models/ultralytics/infer", async (req, reply) => {
  try {
    const upload = await (req as any).file({ limits: { fileSize: 12 * 1024 * 1024 } });
    if (!upload) return reply.code(400).send({ success: false, error: "Frame image is required." });
    const result = await inferUltralyticsFrame(await upload.toBuffer(), Number((upload.fields?.confidence as any)?.value ?? 0.55));
    const regions = await getActiveObsRegions();
    const minimap = firstNormalizedRegion(regions.minimap_norm) ?? undefined;
    return { success: true, data: {
      ...result,
      minimapMarkers: mapUltralyticsMinimapMarkers(result.detections ?? [], minimap),
      minimapObjects: mapUltralyticsMinimapObjects(result.detections ?? [], minimap),
    } };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Ultralytics inference failed" });
  }
});
app.get("/api/vision/models/dino/status", async () => ({ success: true, data: await getDinoIdentityStatus() }));
app.post("/api/vision/models/dino/index", async (_req, reply) => {
  try {
    return { success: true, data: await indexDinoReferences() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "DINO reference indexing failed" });
  }
});
app.post("/api/vision/models/dino/match", async (req, reply) => {
  try {
    let crop: Buffer | null = null;
    let options: any = {};
    for await (const part of (req as any).parts({ limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 2 } })) {
      if (part.type === "file") crop = await part.toBuffer();
      if (part.type === "field" && part.fieldname === "options") options = JSON.parse(String(part.value));
    }
    if (!crop) return reply.code(400).send({ success: false, error: "A hero crop is required." });
    return { success: true, data: await matchDinoIdentity(crop, options) };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "DINO crop matching failed" });
  }
});
app.get("/api/vision/models/timer-ocr/status", async () => ({ success: true, data: await getTimerOcrStatus() }));
app.post("/api/vision/models/timer-ocr/install", async (_req, reply) => {
  try {
    return { success: true, data: await installTimerOcrRuntime() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Timer OCR installation failed" });
  }
});
app.post("/api/vision/models/timer-ocr/infer", async (req, reply) => {
  try {
    let crop: Buffer | null = null;
    let timerType: any = "enemy_respawn_timer";
    for await (const part of (req as any).parts({ limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 2 } })) {
      if (part.type === "file") crop = await part.toBuffer();
      if (part.type === "field" && part.fieldname === "timerType") timerType = String(part.value);
    }
    if (!crop) return reply.code(400).send({ success: false, error: "A timer crop is required." });
    if (!timerClasses.includes(timerType)) return reply.code(400).send({ success: false, error: "Unsupported timer target." });
    return { success: true, data: await inferTimerCrop(crop, timerType) };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Timer OCR failed" });
  }
});
app.get("/api/vision/models/screen-ocr/status", async () => ({ success: true, data: await getScreenOcrStatus() }));
app.get("/api/vision/models/screen-ocr/mlbb-feed/latest", async (req) => {
  const query = req.query as Record<string, unknown>;
  return { success: true, data: await getMlbbHudOcrFeedStatus({ url: query.url, port: query.port }) };
});
app.post("/api/vision/models/screen-ocr/install", async (_req, reply) => {
  try {
    return { success: true, data: await installScreenOcrRuntime() };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Screen OCR installation failed" });
  }
});
app.post("/api/vision/models/screen-ocr/infer", async (req, reply) => {
  try {
    let frame: Buffer | null = null;
    let options: any = {};
    for await (const part of (req as any).parts({ limits: { fileSize: 16 * 1024 * 1024, files: 1, fields: 2 } })) {
      if (part.type === "file") frame = await part.toBuffer();
      if (part.type === "field" && part.fieldname === "options") options = JSON.parse(String(part.value));
    }
    if (!frame) return reply.code(400).send({ success: false, error: "A frame image is required." });
    const profile = options?.profile;
    const activeRegions = options?.regions ?? (profile ? undefined : await getActiveObsRegions());
    return { success: true, data: await inferScreenTextFrame(frame, {
      regions: activeRegions == null ? undefined : normalizeScreenOcrRegions(activeRegions),
      profile,
      maxRegions: Number(options?.maxRegions ?? (profile === "mlbb-hud" ? 12 : 8)),
    }) };
  } catch (error) {
    return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : "Screen OCR failed" });
  }
});
app.get("/api/reasoning/live/latest", async () => ({ success:true, data:getLatestLiveReasoning() }));
app.post("/api/reasoning/live/evaluate", async (req) => ({ success:true, data:ingestLiveReasoning(req.body as any) }));
app.get("/api/reasoning/live/scenarios", async () => ({ success:true, data:listCoachReasoningScenarios() }));
app.get("/api/reasoning/advisory/latest", async () => ({ success:true, data:getLatestAdvisoryCoach() }));
app.get("/api/match/state", async () => ({ success:true, data:getMatchState() }));

app.get("/api/map/runtime", async () => ({ success:true, manifest:getMapRuntimeManifest(), zones:getZones(), projection:getMinimapProjection() }));
app.get("/api/map/zones", async () => ({ success:true, data:getZones() }));
app.post("/api/map/zones", async (req) => ({ success:true, data:saveZones((req.body as any)?.zones ?? req.body) }));
app.post("/api/map/resolve-zone", async (req) => { const body=req.body as any; return { success:true, data: mapPointToZone(body.x,body.y) }; });
app.get("/api/map/projection", async () => ({ success:true, data:getMinimapProjection() }));
app.post("/api/map/projection", async (req) => ({ success:true, data:saveMinimapProjection((req.body as any)?.projection ?? req.body) }));
app.post("/api/map/project-minimap-point", async (req) => { const body=req.body as any; return { success:true, data:projectMinimapPoint(body.x, body.y) }; });
app.post("/api/map/train/upload", async () => ({ success:true, message:"Map training upload shell ready." }));
app.post("/api/map/train/align", async () => ({ success:true, message:"Alignment shell ready." }));
app.post("/api/map/export", async () => ({ success:true, manifest:getMapRuntimeManifest() }));

app.get("/api/modules", async () => ({ success:true, sdk:sdkDescription(), modules:listModules() }));
app.get("/api/modules/sdk", async () => ({ success:true, data:sdkDescription() }));
app.post("/api/modules/install", async (req) => ({ success:true, module:installModule(req.body) }));
app.post("/api/modules/generate", async (req) => ({ success:true, message:"AI module generation placeholder. Connect OpenAI API here with strict SDK context.", sdk:sdkDescription(), request:req.body }));
app.post("/api/events/emit", async (req) => ({ success:true, event:eventBus.emit("manual_event", req.body) }));
app.get("/api/events/recent", async () => ({ success:true, events:eventBus.recent() }));

app.get("/ws/events", { websocket:true }, (socket) => { const unsub = eventBus.subscribe((event)=>socket.send(JSON.stringify(event))); socket.on("close", unsub); });

await registerFrontendStatic();

try {
  const trainingJob = await rehydrateUltralyticsTrainingJob();
  if (trainingJob.state !== "idle") {
    app.log.info(
      { jobId: trainingJob.id, state: trainingJob.state, processAlive: (trainingJob as { processAlive?: boolean }).processAlive },
      "Rehydrated Ultralytics training job from disk.",
    );
  }
} catch (error) {
  app.log.warn({ error }, "Could not rehydrate Ultralytics training job; starting idle.");
}

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`MLBB Co-Pilot backend running on ${HOST}:${PORT}`);
  void ensureObsScrcpyPluginInstalled()
    .then((status) => {
      if (status.obsInstalled && status.bundled) app.log.info({ pluginRoot: status.pluginRoot, upToDate: status.upToDate }, "OBS scrcpy source plugin checked.");
    })
    .catch((error) => app.log.warn({ error }, "OBS scrcpy source plugin auto-install failed."));
} catch(err) { app.log.error(err); process.exit(1); }
