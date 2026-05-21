import type { FastifyInstance } from "fastify";
import { cache } from "../services/cacheService.js";
import { semanticCompiler } from "../engines/semanticCompiler.js";
import { eventBus } from "../event-bus/eventBus.js";

export async function semanticRoutes(app: FastifyInstance) {
  app.post("/api/semantic/compile", async () => { const result = await semanticCompiler.compileAll(); eventBus.emit("semantic_compiled", result); return { success:true, result }; });
  app.get("/api/semantic/compile", async () => { const result = await semanticCompiler.compileAll(); eventBus.emit("semantic_compiled", result); return { success:true, result }; });
  app.get("/api/semantic/items", async () => ({ success:true, data: await cache.read("compiled-items.json", []) }));
  app.get("/api/semantic/heroes", async () => ({ success:true, data: await cache.read("compiled-heroes.json", []) }));
  app.get("/api/semantic/talents", async () => ({ success:true, data: await cache.read("compiled-talents.json", []) }));
}
