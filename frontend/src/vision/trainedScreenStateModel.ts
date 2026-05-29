export type LearnedScreenLabel = "draft" | "loading" | "live_hud";
export type TrainedScreenStateModel = {
  version: string;
  trainedAt: string;
  featureKeys: string[];
  normalization: { mean: number[]; scale: number[] };
  classes: Array<{ label: LearnedScreenLabel; centroid: number[]; acceptanceDistance: number; trainingExamples: number }>;
  validation: { examples: number; correct: number; accuracy: number };
};
type Metric = { mean: number; contrast: number };

export function classifyWithTrainedScreenStateModel(
  model: TrainedScreenStateModel,
  metrics: { minimap: Metric },
  probes: Record<string, Metric>,
) {
  const features = [
    metrics.minimap.mean, metrics.minimap.contrast,
    probes.top_hud.mean, probes.top_hud.contrast,
    probes.draft_left_rail.mean, probes.draft_left_rail.contrast,
    probes.draft_right_rail.mean, probes.draft_right_rail.contrast,
    probes.center_panel.mean, probes.center_panel.contrast,
    probes.modal_body.mean, probes.modal_body.contrast,
  ];
  if (features.length !== model.normalization.mean.length || !model.classes.length) return null;
  const normalized = features.map((value, index) =>
    (value - model.normalization.mean[index]) / Math.max(1, model.normalization.scale[index]));
  const ranking = model.classes
    .map((entry) => ({ ...entry, distance: distance(normalized, entry.centroid) }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranking[0];
  const second = ranking[1];
  const separation = Math.max(0, Number(second?.distance ?? best.distance + 1) - best.distance);
  const accepted = best.distance <= best.acceptanceDistance;
  const confidence = clamp01(0.45 + separation * 0.18 + (accepted ? 0.22 : -0.18));
  return {
    screen: best.label,
    confidence,
    accepted,
    distance: best.distance,
  };
}

function distance(left: number[], right: number[]) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) / Math.max(1, left.length));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
