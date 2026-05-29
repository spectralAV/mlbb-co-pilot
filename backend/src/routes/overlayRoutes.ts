import type { FastifyInstance } from "fastify";
import { getOverlayState, setOverlayState } from "../services/overlayState.js";
import { deleteOverlayMedia, getOverlayMediaConfig, readOverlayMedia, saveOverlayMedia, updateOverlayMediaConfig, type OverlayMediaSlotId } from "../services/overlayMedia.js";

export async function overlayRoutes(app: FastifyInstance) {
  app.get("/api/overlay/state", async () => ({ ok: true, state: getOverlayState() }));
  app.post("/api/overlay/state", async (req) => ({ ok: true, state: setOverlayState(req.body as any) }));
  app.get("/api/overlay/media/config", async () => ({ ok: true, data: await getOverlayMediaConfig() }));
  app.post("/api/overlay/media/config", async (req) => ({ ok: true, data: await updateOverlayMediaConfig(req.body) }));
  app.post("/api/overlay/media/:slot", async (req, reply) => {
    const slot = String((req.params as { slot: string }).slot) as OverlayMediaSlotId;
    if (slot !== "logo" && slot !== "sponsor") return reply.code(404).send({ ok: false, error: "Unknown overlay media slot." });
    try {
      const upload = await (req as any).file({ limits: { fileSize: 120 * 1024 * 1024 } });
      if (!upload) return reply.code(400).send({ ok: false, error: "Media file is required." });
      return { ok: true, data: await saveOverlayMedia(slot, upload.filename, await upload.toBuffer()) };
    } catch (error) {
      return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "Media upload failed." });
    }
  });
  app.delete("/api/overlay/media/:slot", async (req, reply) => {
    const slot = String((req.params as { slot: string }).slot) as OverlayMediaSlotId;
    if (slot !== "logo" && slot !== "sponsor") return reply.code(404).send({ ok: false, error: "Unknown overlay media slot." });
    return { ok: true, data: await deleteOverlayMedia(slot) };
  });
  app.get("/api/overlay/media/:slot/file", async (req, reply) => {
    const slot = String((req.params as { slot: string }).slot) as OverlayMediaSlotId;
    if (slot !== "logo" && slot !== "sponsor") return reply.code(404).send();
    const media = await readOverlayMedia(slot);
    if (!media) return reply.code(404).send();
    return reply.header("cache-control", "no-cache").type(media.mimeType).send(media.data);
  });
}
