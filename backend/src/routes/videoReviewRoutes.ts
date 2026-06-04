import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getVideoReview,
  listFootageManifests,
  listVideoReviews,
  runVideoCvReview,
} from "../services/videoCvReview.js";

const ReviewRequestSchema = z.object({
  footage: z.string().min(1),
  sampleIntervalSeconds: z.number().positive().optional(),
  maxFrames: z.number().int().positive().optional(),
  runYolo: z.boolean().optional(),
  yoloConfidence: z.number().min(0).max(1).optional(),
  minSegmentConfidence: z.number().min(0).max(1).optional(),
  replayCoach: z.boolean().optional(),
});

export async function videoReviewRoutes(app: FastifyInstance) {
  app.get("/api/cv/video/footage", async () => ({
    success: true,
    data: await listFootageManifests(),
  }));

  app.get("/api/cv/video/reviews", async () => ({
    success: true,
    data: await listVideoReviews(),
  }));

  app.get("/api/cv/video/reviews/:id", async (req, reply) => {
    const id = String((req.params as { id?: string }).id ?? "");
    const review = await getVideoReview(id);
    if (!review) return reply.code(404).send({ success: false, error: "Review not found" });
    return { success: true, data: review };
  });

  app.post("/api/cv/video/review", async (req, reply) => {
    try {
      const input = ReviewRequestSchema.parse(req.body);
      const review = await runVideoCvReview(input.footage, {
        sampleIntervalSeconds: input.sampleIntervalSeconds,
        maxFrames: input.maxFrames,
        runYolo: input.runYolo,
        yoloConfidence: input.yoloConfidence,
        minSegmentConfidence: input.minSegmentConfidence,
        replayCoach: input.replayCoach,
      });
      return { success: true, data: review };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video review failed";
      return reply.code(400).send({ success: false, error: message });
    }
  });
}
