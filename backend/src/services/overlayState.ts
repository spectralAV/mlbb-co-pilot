export type OverlayState = {
  mode: string;
  bestPick: string;
  confidence: number;
  reason: string;
  warning: string;
  updatedAt: string;
};

let state: OverlayState = {
  mode: "draft",
  bestPick: "",
  confidence: 0,
  reason: "Waiting for draft recommendation.",
  warning: "",
  updatedAt: new Date().toISOString()
};

export function getOverlayState() {
  return state;
}

export function setOverlayState(next: Partial<OverlayState>) {
  state = { ...state, ...next, updatedAt: new Date().toISOString() };
  return state;
}
