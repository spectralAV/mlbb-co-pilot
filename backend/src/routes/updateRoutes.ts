import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { applyPatch } from "../updates/applyPatch.js";

let lastUpdate: any = { ok: true, applied: false, updatedAt: null };

export async function updateRoutes(app: FastifyInstance) {
  app.post("/api/updates/apply", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ ok: false, error: "No patch ZIP uploaded." });
    if (!part.filename.toLowerCase().endsWith(".zip")) {
      await part.toBuffer();
      return reply.code(400).send({ ok: false, error: "Patch upload must be a ZIP file." });
    }

    const tempPath = path.join(os.tmpdir(), `mlbb-patch-${Date.now()}-${part.filename.replace(/[^a-z0-9_.-]/gi, "_")}`);
    try {
      await fs.writeFile(tempPath, await part.toBuffer());
      const result = await applyPatch(tempPath);
      lastUpdate = { ok: true, applied: true, updatedAt: new Date().toISOString(), result };
      return result;
    } catch (error) {
      lastUpdate = { ok: false, applied: false, updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
      return reply.code(400).send(lastUpdate);
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  });

  app.get("/api/updates/status", async () => lastUpdate);
}
