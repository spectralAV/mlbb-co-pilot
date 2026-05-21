import type { FastifyInstance } from "fastify";
import { readRuntime } from "../runtime/RuntimeStore.js";

export async function runtimeRoutes(app: FastifyInstance) {
  app.get("/api/runtime", async () => ({ ok: true, runtime: await readRuntime() }));

  app.get("/api/runtime/heroes", async () => {
    const runtime = await readRuntime();
    return { ok: true, heroes: runtime?.heroes ?? [] };
  });

  app.get("/api/runtime/status", async () => {
    const runtime = await readRuntime();
    return {
      ok: true,
      exists: Boolean(runtime),
      heroCount: runtime?.heroes?.length ?? 0,
      updatedAt: runtime?.generatedAt ?? null
    };
  });
}
