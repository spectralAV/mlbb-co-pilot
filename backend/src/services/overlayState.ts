export type OverlayState = {
  mode: string;
  bestPick: string;
  confidence: number;
  reason: string;
  warning: string;
  activeScene: "hidden" | "draft" | "matchup" | "objective" | "alert" | "build";
  teamBlue: string;
  teamRed: string;
  blueScore: number;
  redScore: number;
  matchPhase: string;
  timer: string;
  objective: string;
  objectiveTimer: string;
  lowerTitle: string;
  lowerSubtitle: string;
  accent: "cyan" | "emerald" | "violet" | "amber" | "red";
  showTicker: boolean;
  ticker: string[];
  buildPath: string[];
  mapTitle: string;
  mapSubtitle: string;
  mapFocus: string;
  mapPlan: string[];
  mapCallout: string;
  textKicker: string;
  textTitle: string;
  textBody: string;
  textFooter: string;
  counterTitle: string;
  counterValue: string;
  counterLabel: string;
  counterItems: string[];
  picksTitle: string;
  picksSubtitle: string;
  allyPicks: string[];
  enemyPicks: string[];
  updatedAt: string;
};

let state: OverlayState = {
  mode: "waiting",
  bestPick: "",
  confidence: 0,
  reason: "Waiting for draft recommendation.",
  warning: "",
  activeScene: "hidden",
  teamBlue: "ALLY",
  teamRed: "ENEMY",
  blueScore: 0,
  redScore: 0,
  matchPhase: "Awaiting detection",
  timer: "--:--",
  objective: "Objective",
  objectiveTimer: "--:--",
  lowerTitle: "MLBB Co-Pilot",
  lowerSubtitle: "Waiting for reliable detected state.",
  accent: "cyan",
  showTicker: true,
  ticker: [],
  buildPath: [],
  mapTitle: "Detected map state",
  mapSubtitle: "Waiting for reliable tactical signal.",
  mapFocus: "No verified pressure",
  mapPlan: [],
  mapCallout: "No detected map callout.",
  textKicker: "Detected reasoning",
  textTitle: "No reliable live callout",
  textBody: "Waiting for detected evidence.",
  textFooter: "CV confidence gate active",
  counterTitle: "Detected count",
  counterValue: "-",
  counterLabel: "No confirmed warning",
  counterItems: [],
  picksTitle: "Detected Draft State",
  picksSubtitle: "Awaiting confirmed portraits",
  allyPicks: [],
  enemyPicks: [],
  updatedAt: new Date().toISOString()
};

export function getOverlayState() {
  return state;
}

export function setOverlayState(next: Partial<OverlayState>) {
  state = { ...state, ...next, updatedAt: new Date().toISOString() };
  return state;
}
