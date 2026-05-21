import type { FastifyInstance } from "fastify";
import { getOverlayState, setOverlayState } from "../services/overlayState.js";

export async function overlayRoutes(app: FastifyInstance) {
  app.get("/api/overlay/state", async () => ({ ok: true, state: getOverlayState() }));
  app.post("/api/overlay/state", async (req) => ({ ok: true, state: setOverlayState(req.body as any) }));
}
