import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncOfficialData } from "../providers/mlbb/syncOfficialData.js";

const SyncSchema = z.object({
  authorization: z.string().min(8),
  rank: z.string().default("101"),
  matchType: z.number().default(0),
  lang: z.string().default("en")
});

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Sync failed";
  return message.replace(/authorization[^\s"]+/gi, "authorization [redacted]");
}

export async function syncRoutes(app: FastifyInstance) {
  app.post("/api/sync/official", async (req, reply) => {
    try {
      const input = SyncSchema.parse(req.body) as { authorization: string; rank?: string; matchType?: number; lang?: string };
      return await syncOfficialData(input);
    } catch (error) {
      return reply.code(400).send({ ok: false, error: safeError(error) });
    }
  });
}
