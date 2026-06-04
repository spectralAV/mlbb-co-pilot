import type { FastifyInstance } from "fastify";
import { getLatestDraftRecognition, ingestDraftRecognition } from "../vision/draftRecognition.js";
import {
  approveDraft,
  denyDraft,
  getDraftFeedbackStatus,
  rosterFingerprint,
  rosterToManualIngest,
} from "../services/draftGroundTruth.js";

function slotIdsFromStore(body: any) {
  const toRow = (slots: unknown) => {
    const row = Array.from({ length: 5 }, () => null as number | null);
    if (!Array.isArray(slots)) return row;
    for (const [index, slot] of slots.entries()) {
      const heroId = typeof slot === "number" ? slot : Number(slot?.heroId);
      if (!Number.isFinite(heroId)) continue;
      const detectedIndex = Number(slot?.slot) - 1;
      const destination = Number.isInteger(detectedIndex) && detectedIndex >= 0 && detectedIndex < 5
        ? detectedIndex
        : index;
      if (destination >= 0 && destination < 5) row[destination] = heroId;
    }
    return row;
  };
  return {
    phase: String(body?.phase ?? "pick"),
    allyPicks: toRow(body?.allyPicks),
    enemyPicks: toRow(body?.enemyPicks),
    allyBans: toRow(body?.allyBans),
    enemyBans: toRow(body?.enemyBans),
    selectedLane: body?.selectedLane,
    selfSlot: body?.selfSlot,
    firstPickSide: body?.firstPickSide,
    laneOrientation: body?.laneOrientation,
  };
}

export async function draftFeedbackRoutes(app: FastifyInstance) {
  app.get("/api/draft/feedback/status", async () => ({
    success: true,
    data: await getDraftFeedbackStatus(),
  }));

  app.post("/api/draft/feedback/approve", async (req, reply) => {
    try {
      const body = req.body as any;
      const state = body?.useLatest
        ? getLatestDraftRecognition()?.state
        : slotIdsFromStore(body);
      if (!state) {
        return reply.code(400).send({ success: false, error: "No draft state to approve. Run capture or pass roster slots." });
      }
      const approval = await approveDraft(state, { note: body?.note });
      const ingest = rosterToManualIngest({ ...state, userFeedback: "approved" });
      const data = await ingestDraftRecognition({
        ...ingest,
        frameId: body?.frameId ?? `approved:${approval.fingerprint.slice(0, 12)}`,
        timestamp: Date.now(),
      });
      return { success: true, data: { approval, recognition: data } };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error instanceof Error ? error.message : "Draft approve failed.",
      });
    }
  });

  app.post("/api/draft/feedback/deny", async (req, reply) => {
    try {
      const body = req.body as any;
      const corrected = slotIdsFromStore(body?.corrected ?? body);
      const latest = getLatestDraftRecognition()?.state;
      const denied = await denyDraft({
        cvFingerprint: body?.cvFingerprint ?? rosterFingerprint(latest),
        corrected,
        deniedRecognition: latest,
        yoloBoxes: Array.isArray(body?.yoloBoxes) ? body.yoloBoxes : [],
        diagnostics: body?.diagnostics,
      });
      const data = await ingestDraftRecognition({
        ...rosterToManualIngest(denied.corrected),
        frameId: body?.frameId ?? `corrected:${Date.now()}`,
        timestamp: Date.now(),
        diagnostics: body?.diagnostics,
      });
      return {
        success: true,
        data: {
          cvFingerprint: denied.cvFingerprint,
          annotationId: denied.annotationId,
          recognition: data,
        },
      };
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error instanceof Error ? error.message : "Draft deny failed.",
      });
    }
  });
}
