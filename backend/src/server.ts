import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { PORT } from "./config.js";
import { cache } from "./services/cacheService.js";
import { semanticRegistry } from "./services/semanticRegistry.js";
import { mlbbIo } from "./services/mlbbIoService.js";
import { semanticRoutes } from "./routes/semanticRoutes.js";
import { buildHeroRoutes } from "./routes/buildHeroRoutes.js";
import { overlayRoutes } from "./routes/overlayRoutes.js";
import { obsCoachRoutes } from "./routes/obsCoachRoutes.js";
import { runtimeRoutes } from "./routes/runtimeRoutes.js";
import { syncRoutes } from "./routes/syncRoutes.js";
import { updateRoutes } from "./routes/updateRoutes.js";
import { analyzeDraft } from "./engines/draftEngine.js";
import { analyzeBuild } from "./engines/buildEngine.js";
import { eventBus } from "./event-bus/eventBus.js";
import { getMapRuntimeManifest, getZones, mapPointToZone, saveZones } from "./map-runtime/mapRuntime.js";
import { installModule, listModules, sdkDescription } from "./module-runtime/moduleRuntime.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(multipart);
await app.register(websocket);
await app.register(semanticRoutes);
await app.register(buildHeroRoutes);
await app.register(syncRoutes);
await app.register(runtimeRoutes);
await app.register(updateRoutes);
await app.register(overlayRoutes);
await app.register(obsCoachRoutes);

app.get("/api/health", async () => ({ ok: true, service: "MLBB Co-Pilot", time: new Date().toISOString() }));
app.post("/api/sync/all", async () => { const result = await mlbbIo.syncAll(); eventBus.emit("data_synced", result); return { success:true, result }; });
app.get("/api/sync/all", async () => { const result = await mlbbIo.syncAll(); eventBus.emit("data_synced", result); return { success:true, result }; });
app.post("/api/sync/heroes", async () => ({ success:true, data: await mlbbIo.syncHeroes() }));
app.post("/api/sync/items", async () => ({ success:true, data: await mlbbIo.syncItems() }));
app.post("/api/sync/emblems", async () => ({ success:true, data: await mlbbIo.syncEmblems() }));
app.post("/api/sync/talents", async () => ({ success:true, data: await mlbbIo.syncTalents() }));

app.get("/api/cache/:name", async (req) => { const { name } = req.params as {name:string}; const allowed = new Set(["heroes","items","emblems","talents","tiers","builds","compiled-items","compiled-heroes","compiled-talents","metadata"]); if(!allowed.has(name)) return {success:false,error:"Unknown cache"}; return {success:true,data: await cache.read(`${name}.json`, [])}; });
app.get("/api/cache/metadata", async () => ({ success:true, data: await cache.read("metadata.json", {}) }));

app.post("/api/draft/analyze", async (req) => { const result = await analyzeDraft(req.body as any); eventBus.emit("draft_updated", result); return {success:true,data:result}; });
app.post("/api/draft/recommend", async (req) => { const body=req.body as any; return {success:true,data: await mlbbIo.combinedRecommendations(body.allyHeroes??[], body.enemyHeroes??[])}; });
app.post("/api/draft/counters", async (req) => { const body=req.body as any; return {success:true,data: await mlbbIo.counterPickSuggestions(body.enemyHeroes??[])}; });
app.post("/api/build/analyze", async (req) => { const body=req.body as any; return {success:true,data: await analyzeBuild(body.heroId, body.enemyHeroIds??[])}; });
app.get("/api/registry/overview", async () => ({ success:true, data: await semanticRegistry.overview() }));

app.get("/api/map/runtime", async () => ({ success:true, manifest:getMapRuntimeManifest(), zones:getZones() }));
app.get("/api/map/zones", async () => ({ success:true, data:getZones() }));
app.post("/api/map/zones", async (req) => ({ success:true, data:saveZones((req.body as any)?.zones ?? req.body) }));
app.post("/api/map/resolve-zone", async (req) => { const body=req.body as any; return { success:true, data: mapPointToZone(body.x,body.y) }; });
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

try { await app.listen({ port: PORT, host:"0.0.0.0" }); console.log(`MLBB Co-Pilot backend running on :${PORT}`); } catch(err) { app.log.error(err); process.exit(1); }
