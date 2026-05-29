import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { syncOfficialData } from "../providers/mlbb/syncOfficialData.js";
import { getMlbbAdbAssetStatus, readMlbbAdbTexture, syncMlbbAdbAssets } from "../services/mlbbAdbAssets.js";
import { compileSkinPortraitSignatures, getSkinPortraitManifest } from "../vision/skinPortraitRecognition.js";

const SyncSchema = z.object({
  authorization: z.string().min(8),
  rank: z.string().default("101"),
  matchType: z.number().default(0),
  lang: z.string().default("en")
});
const AdbAssetSyncSchema = z.object({
  scope: z.enum(["draft", "vision", "ui"]).default("draft"),
}).default({});

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Sync failed";
  return message.replace(/authorization[^\s"]+/gi, "authorization [redacted]");
}

export async function syncRoutes(app: FastifyInstance) {
  app.post("/api/sync/official", async (req, reply) => {
    try {
      const input = SyncSchema.parse(req.body) as { authorization: string; rank?: string; matchType?: number; lang?: string };
      const result = await syncOfficialData(input);
      const skinManifest = await getSkinPortraitManifest();
      const visionSignatures = skinManifest.portraitCount > 0
        ? await compileSkinPortraitSignatures()
        : null;
      return {
        ...result,
        visionSignatures: visionSignatures
          ? {
            portraitCount: visionSignatures.portraitCount,
            referenceCount: visionSignatures.referenceCount,
            compiledAt: visionSignatures.compiledAt,
          }
          : null,
      };
    } catch (error) {
      return reply.code(400).send({ ok: false, error: safeError(error) });
    }
  });

  app.get("/api/sync/adb-assets/status", async () => ({ success: true, data: await getMlbbAdbAssetStatus() }));

  app.post("/api/sync/adb-assets", async (req, reply) => {
    try {
      const { scope } = AdbAssetSyncSchema.parse(req.body);
      return { success: true, data: await syncMlbbAdbAssets(scope) };
    } catch (error) {
      return reply.code(400).send({ success: false, error: safeError(error) });
    }
  });

  app.get("/api/sync/adb-assets/texture/*", async (req, reply) => {
    const relativePath = String((req.params as Record<string, string>)["*"] ?? "");
    const texture = await readMlbbAdbTexture(relativePath);
    if (!texture) return reply.code(404).send({ success: false, error: "Unknown ADB texture reference" });
    return reply.header("cache-control", "private, max-age=3600").type("image/png").send(texture);
  });
}
