import { type ChangeEvent, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, Film, Hash, MessageSquareText, Radio, RotateCcw, Shield, Swords, Timer, Trash2, Trophy, Upload } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { apiGet, deleteOverlayMedia, getMatchState, getOverlayMediaConfig, getOverlayState, updateOverlayMediaConfig, updateOverlayState, uploadOverlayMedia } from "../api/client";
import { CaptureRuntimeHost } from "../components/CaptureRuntimeHost";
import { BattlefieldMap, type TacticalMapMarker } from "../components/game/BattlefieldMap";
import { type MapZoneState, defaultMapZones } from "../lib/gameTypes";
import { startSelectedCaptureRuntime, stopCaptureRuntime, useCaptureRuntimeStore } from "../runtime/captureRuntime";
import { resolveHeroIcon, resolveSpellIcon } from "../utils/assetResolver";

type Scene = "hidden" | "draft" | "matchup" | "objective" | "alert" | "build";
type Accent = "cyan" | "emerald" | "violet" | "amber" | "red";

type LocalOverlayState = {
  mode: string;
  bestPick: string;
  confidence: number;
  reason: string;
  warning: string;
  activeScene: Scene;
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
  accent: Accent;
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
  allyBans: string[];
  enemyBans: string[];
  allyLanes: string[];
  selectedLane: string;
  selfSlot: string;
  firstPickSide: string;
  detectedSpell: string;
  recommendedSpell: string;
  spellReason: string;
  updatedAt: string;
};

type HeroVisual = {
  name: string;
  icon?: string;
  roles: string[];
  lanes: string[];
  specialties: string[];
};

type OverlayMediaSlotId = "logo" | "sponsor";
type OverlayMediaSlot = {
  enabled: boolean;
  fileName: string;
  mediaType: "video" | "image" | "";
  mimeType: string;
  chromaKey: {
    enabled: boolean;
    color: string;
    tolerance: number;
    softness: number;
  };
};
type OverlayMediaConfig = {
  bandEnabled: boolean;
  bandOpacity: number;
  logo: OverlayMediaSlot;
  sponsor: OverlayMediaSlot;
  updatedAt: string;
};

function defaultMediaSlot(): OverlayMediaSlot {
  return {
    enabled: true,
    fileName: "",
    mediaType: "",
    mimeType: "",
    chromaKey: { enabled: false, color: "#00ff00", tolerance: 78, softness: 30 },
  };
}

const defaultMediaConfig: OverlayMediaConfig = {
  bandEnabled: true,
  bandOpacity: 0.93,
  logo: defaultMediaSlot(),
  sponsor: defaultMediaSlot(),
  updatedAt: "",
};

const defaultState: LocalOverlayState = {
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
  picksSubtitle: "Awaiting confirmed draft facts",
  allyPicks: [],
  enemyPicks: [],
  allyBans: [],
  enemyBans: [],
  allyLanes: [],
  selectedLane: "",
  selfSlot: "",
  firstPickSide: "",
  detectedSpell: "",
  recommendedSpell: "",
  spellReason: "",
  updatedAt: new Date().toISOString()
};

const accentClasses: Record<Accent, { text: string; bg: string; border: string; glow: string; solid: string }> = {
  cyan: { text: "text-cyan-200", bg: "bg-cyan-500/20", border: "border-cyan-300/40", glow: "shadow-cyan-500/30", solid: "bg-cyan-400" },
  emerald: { text: "text-emerald-200", bg: "bg-emerald-500/20", border: "border-emerald-300/40", glow: "shadow-emerald-500/30", solid: "bg-emerald-400" },
  violet: { text: "text-violet-200", bg: "bg-violet-500/20", border: "border-violet-300/40", glow: "shadow-violet-500/30", solid: "bg-violet-400" },
  amber: { text: "text-amber-200", bg: "bg-amber-500/20", border: "border-amber-300/40", glow: "shadow-amber-500/30", solid: "bg-amber-400" },
  red: { text: "text-red-200", bg: "bg-red-500/20", border: "border-red-300/40", glow: "shadow-red-500/30", solid: "bg-red-400" }
};

const scenes: Array<{ id: Scene; label: string; icon: typeof Eye }> = [
  { id: "draft", label: "Draft", icon: Swords },
  { id: "matchup", label: "Matchup", icon: Trophy },
  { id: "objective", label: "Objective", icon: Timer },
  { id: "alert", label: "Alert", icon: AlertTriangle },
  { id: "build", label: "Build", icon: Shield },
  { id: "hidden", label: "Hide", icon: EyeOff },
];

function mergeState(next: Partial<LocalOverlayState>) {
  return {
    ...defaultState,
    ...next,
    ticker: Array.isArray(next.ticker) ? next.ticker : defaultState.ticker,
    buildPath: Array.isArray(next.buildPath) ? next.buildPath : defaultState.buildPath,
    mapPlan: Array.isArray(next.mapPlan) ? next.mapPlan : defaultState.mapPlan,
    counterItems: Array.isArray(next.counterItems) ? next.counterItems : defaultState.counterItems,
    allyPicks: Array.isArray(next.allyPicks) ? next.allyPicks : defaultState.allyPicks,
    enemyPicks: Array.isArray(next.enemyPicks) ? next.enemyPicks : defaultState.enemyPicks,
    allyBans: Array.isArray(next.allyBans) ? next.allyBans : defaultState.allyBans,
    enemyBans: Array.isArray(next.enemyBans) ? next.enemyBans : defaultState.enemyBans,
    allyLanes: Array.isArray(next.allyLanes) ? next.allyLanes : defaultState.allyLanes,
  };
}

function useOverlayState() {
  const [state, setState] = useState<LocalOverlayState>(defaultState);
  const [matchState, setMatchState] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const [overlayResult, matchResult] = await Promise.allSettled([getOverlayState(), getMatchState()]);
      if (!active) return;
      if (overlayResult.status === "fulfilled") setState(mergeState(overlayResult.value.state ?? overlayResult.value));
      if (matchResult.status === "fulfilled") setMatchState(matchResult.value.data ?? null);
    }
    void load();
    const timer = window.setInterval(load, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function patch(partial: Partial<LocalOverlayState>) {
    setState((current) => ({ ...current, ...partial }));
    setSaving(true);
    try {
      const result = await updateOverlayState(partial);
      setState(mergeState(result.state ?? result));
    } finally {
      setSaving(false);
    }
  }

  return { state, matchState, patch, saving };
}

function normalizeMediaConfig(value: any): OverlayMediaConfig {
  return {
    ...defaultMediaConfig,
    ...value,
    logo: { ...defaultMediaConfig.logo, ...(value?.logo ?? {}), chromaKey: { ...defaultMediaConfig.logo.chromaKey, ...(value?.logo?.chromaKey ?? {}) } },
    sponsor: { ...defaultMediaConfig.sponsor, ...(value?.sponsor ?? {}), chromaKey: { ...defaultMediaConfig.sponsor.chromaKey, ...(value?.sponsor?.chromaKey ?? {}) } },
  };
}

function useOverlayMedia() {
  const [config, setConfig] = useState<OverlayMediaConfig>(defaultMediaConfig);
  const [busy, setBusy] = useState<OverlayMediaSlotId | "settings" | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await getOverlayMediaConfig();
        if (active) setConfig(normalizeMediaConfig(result.data));
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load overlay media.");
      }
    }
    void load();
    const timer = window.setInterval(load, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function patch(next: Partial<OverlayMediaConfig>) {
    setBusy("settings");
    setError("");
    try {
      const result = await updateOverlayMediaConfig(next);
      setConfig(normalizeMediaConfig(result.data));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save overlay media settings.");
    } finally {
      setBusy("");
    }
  }

  async function upload(slot: OverlayMediaSlotId, file: File) {
    setBusy(slot);
    setError("");
    try {
      const result = await uploadOverlayMedia(slot, file);
      setConfig(normalizeMediaConfig(result.data));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Media upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function remove(slot: OverlayMediaSlotId) {
    setBusy(slot);
    setError("");
    try {
      const result = await deleteOverlayMedia(slot);
      setConfig(normalizeMediaConfig(result.data));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove media.");
    } finally {
      setBusy("");
    }
  }

  return { config, busy, error, patch, upload, remove };
}

function currentMatch(matchState: any) {
  const receivedAt = Date.parse(String(matchState?.updatedAt ?? ""));
  return Number.isFinite(receivedAt) && Date.now() - receivedAt < 12000 ? matchState : null;
}

function currentReasoning(matchState: any) {
  const current = currentMatch(matchState);
  return current?.confidence?.reasoningTrusted ? current.reasoning : null;
}

function currentDraft(matchState: any) {
  const current = currentMatch(matchState);
  return current?.confidence?.draftTrusted && current?.lifecycle?.screen === "draft" ? current.draft : null;
}

function getDisplayState(state: LocalOverlayState, matchState: any): LocalOverlayState {
  const current = currentMatch(matchState);
  const live = currentReasoning(current);
  const draft = currentDraft(current);
  const topPick = draft?.analysis?.bestPick;
  const ally = positionedPicks(draft?.allyPicks);
  const enemy = positionedPicks(draft?.enemyPicks);
  const allyBans = (draft?.allyBans ?? []).map((slot: any) => slot.heroName).filter(Boolean);
  const enemyBans = (draft?.enemyBans ?? []).map((slot: any) => slot.heroName).filter(Boolean);
  const allyLanes = [...(draft?.allyLanes ?? [])]
    .sort((left: any, right: any) => Number(left.slot) - Number(right.slot))
    .map((fact: any) => `P${fact.slot} ${String(fact.lane).toUpperCase()}`);
  const selectedLane = String(draft?.selectedLane?.value ?? "");
  const selfSlot = draft?.selfSlot?.value ? `Ally slot ${draft.selfSlot.value}` : "";
  const firstPickSide = draft?.firstPickSide?.value === "ally"
    ? "Ally first pick"
    : draft?.firstPickSide?.value === "enemy" ? "Enemy first pick" : "";
  const detectedSpell = String(draft?.allySpells?.find((fact: any) => fact.slot === draft?.selfSlot?.value)?.spell ?? "");
  const spellRecommendation = draft?.analysis?.battleSpells?.recommendations?.[0];
  const missingCount = Number(live?.observation?.missingEnemyCount);
  const plan = live ? [live.recommendedAction, live.reason].filter((line, index, list) => line && list.indexOf(line) === index) : [];
  const activeScene: Scene = draft ? "draft" : live?.scene === "text" || live?.scene === "counter" ? "alert" : "hidden";
  return {
    ...state,
    mode: current?.lifecycle?.screen ?? "waiting",
    activeScene,
    bestPick: topPick?.hero || "Awaiting detected picks",
    confidence: Number(topPick?.score ?? 0),
    reason: topPick?.reasons?.[0] || "Waiting for confirmed draft facts.",
    warning: live?.callout || "",
    matchPhase: draft ? `Detected ${draft.phase}` : current?.lifecycle?.screen ? `Detected ${current.lifecycle.screen}` : "Awaiting detection",
    timer: "--:--",
    objective: String(live?.observation?.objectiveName ?? "Objective"),
    objectiveTimer: Number.isFinite(Number(live?.observation?.objectiveSpawnsInSec)) ? `${live.observation.objectiveSpawnsInSec}s` : "--:--",
    lowerTitle: "Detected state",
    lowerSubtitle: live?.callout || (draft ? "Confirmed draft facts" : "Waiting for reliable frame"),
    ticker: live ? [live.callout, live.recommendedAction].filter(Boolean) : [],
    buildPath: live?.itemAdjustment ? [live.itemAdjustment] : [],
    mapTitle: String(live?.observation?.objectiveName ?? "Detected map state"),
    mapSubtitle: live?.reason || "Waiting for reliable tactical signal.",
    mapFocus: live ? `${live.priority} priority` : "No verified pressure",
    mapPlan: plan,
    mapCallout: live?.callout || "No detected map callout.",
    textKicker: "Detected reasoning",
    textTitle: live?.callout || "No reliable live callout",
    textBody: live?.reason || "Waiting for detected evidence.",
    textFooter: live?.recommendedAction || "CV confidence gate active",
    counterTitle: Number.isFinite(missingCount) ? "Enemies missing" : "Detected count",
    counterValue: Number.isFinite(missingCount) ? String(missingCount) : "-",
    counterLabel: live?.callout || "No confirmed warning",
    counterItems: live ? [live.recommendedAction, live.reason, ...(live.itemAdjustment ? [live.itemAdjustment] : [])].filter(Boolean) : [],
    picksTitle: "Detected Draft State",
    picksSubtitle: draft ? `${Math.round(Number(draft.confidence) * 100)}% fact confidence` : "Awaiting confirmed draft facts",
    allyPicks: ally,
    enemyPicks: enemy,
    allyBans,
    enemyBans,
    allyLanes,
    selectedLane,
    selfSlot,
    firstPickSide,
    detectedSpell,
    recommendedSpell: String(spellRecommendation?.spell ?? ""),
    spellReason: String(spellRecommendation?.reason ?? ""),
  };
}

function positionedPicks(detected: any[] | undefined) {
  if (!detected?.length) return [];
  const picks = Array.from({ length: 5 }, () => "");
  for (const fact of detected) {
    const hero = String(fact?.heroName ?? "").trim();
    if (!hero) continue;
    const index = Number(fact?.slot) - 1;
    const destination = Number.isInteger(index) && index >= 0 && index < picks.length
      ? index
      : picks.indexOf("");
    if (destination >= 0) picks[destination] = hero;
  }
  return picks;
}

function OutputShell({ children, bg }: { children: ReactNode; bg: string }) {
  const background = bg === "green" ? "#00ff00" : bg === "black" ? "#000" : "transparent";
  return <main className="relative h-screen w-screen overflow-hidden text-white" style={{ background }}>
    {children}
  </main>;
}

function ScoreBug({ state }: { state: LocalOverlayState; key?: string }) {
  const accent = accentClasses[state.accent];
  return <motion.div initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -80, opacity: 0 }} className="absolute inset-x-0 top-5 z-20 flex justify-center">
    <div className="w-[min(760px,70vw)]">
      <div className={`grid h-16 grid-cols-[1fr_88px_1fr] overflow-hidden border ${accent.border} bg-slate-950/92 shadow-2xl ${accent.glow}`} style={{ clipPath: "polygon(3% 0, 97% 0, 100% 50%, 97% 100%, 3% 100%, 0 50%)" }}>
      <div className="flex items-center justify-end gap-3 bg-sky-500/20 px-8">
        <span className="truncate text-2xl font-black uppercase tracking-normal">{state.teamBlue}</span>
        <span className="text-4xl font-black text-sky-200">{state.blueScore}</span>
      </div>
      <div className="grid place-items-center border-x border-white/10 bg-black/55">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">MLBB</div>
        <div className="text-sm font-black text-white">{state.timer}</div>
      </div>
      <div className="flex items-center gap-3 bg-red-500/20 px-8">
        <span className="text-4xl font-black text-red-200">{state.redScore}</span>
        <span className="truncate text-2xl font-black uppercase tracking-normal">{state.teamRed}</span>
      </div>
      </div>
      <div className={`mx-auto mt-1 w-fit border ${accent.border} bg-black/75 px-5 py-1 text-xs font-black uppercase tracking-[0.18em] ${accent.text}`}>{state.matchPhase}</div>
    </div>
  </motion.div>;
}

function DraftPanel({ state }: { state: LocalOverlayState; key?: string }) {
  const accent = accentClasses[state.accent];
  return <motion.section initial={{ x: -120, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -120, opacity: 0 }} className={`absolute bottom-[15%] left-8 w-[min(660px,48vw)] border ${accent.border} bg-slate-950/92 p-5 shadow-2xl ${accent.glow}`}>
    <div className="flex items-start justify-between gap-5">
      <div>
        <div className={`text-xs font-black uppercase tracking-[0.24em] ${accent.text}`}>Best pick call</div>
        <h1 className="mt-2 text-6xl font-black uppercase leading-none tracking-normal">{state.bestPick}</h1>
        <p className="mt-3 max-w-xl text-lg font-semibold text-slate-200">{state.reason}</p>
        {state.recommendedSpell && <p className="mt-3 text-sm font-bold uppercase text-cyan-100">Spell: {state.recommendedSpell} <span className="normal-case text-slate-300">{state.spellReason}</span></p>}
      </div>
      <div className={`grid h-24 w-24 shrink-0 place-items-center border ${accent.border} ${accent.bg}`}>
        <div className="text-center">
          <div className="text-4xl font-black">{state.confidence}</div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-300">Score</div>
        </div>
      </div>
    </div>
  </motion.section>;
}

function ObjectivePanel({ state }: { state: LocalOverlayState; key?: string }) {
  const accent = accentClasses[state.accent];
  return <div className="absolute inset-x-0 top-[34%] flex justify-center">
    <motion.section initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }} className={`w-[min(720px,58vw)] border ${accent.border} bg-black/88 px-10 py-8 text-center shadow-2xl ${accent.glow}`}>
      <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full ${accent.bg} ${accent.text}`}><Timer className="h-8 w-8" /></div>
      <div className={`text-sm font-black uppercase tracking-[0.26em] ${accent.text}`}>Next objective</div>
      <div className="mt-2 text-7xl font-black uppercase leading-none">{state.objective}</div>
      <div className="mt-3 text-5xl font-black text-white">{state.objectiveTimer}</div>
    </motion.section>
  </div>;
}

function AlertPanel({ state }: { state: LocalOverlayState; key?: string }) {
  return <motion.section initial={{ x: 120, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 120, opacity: 0 }} className="absolute bottom-[18%] right-8 w-[min(620px,42vw)] border border-red-300/50 bg-red-950/90 p-5 shadow-2xl shadow-red-500/30">
    <div className="flex items-start gap-4">
      <div className="grid h-16 w-16 shrink-0 place-items-center bg-red-400 text-red-950"><AlertTriangle className="h-9 w-9" /></div>
      <div>
        <div className="text-xs font-black uppercase tracking-[0.24em] text-red-200">Team callout</div>
        <h2 className="mt-2 text-4xl font-black uppercase leading-tight">{state.warning || "Map stable"}</h2>
      </div>
    </div>
  </motion.section>;
}

function BuildPanel({ state }: { state: LocalOverlayState; key?: string }) {
  const accent = accentClasses[state.accent];
  return <div className="absolute inset-x-0 bottom-9 flex justify-center">
    <motion.section initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} className={`w-[min(980px,78vw)] border ${accent.border} bg-slate-950/92 p-4 shadow-2xl ${accent.glow}`}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className={`text-xs font-black uppercase tracking-[0.24em] ${accent.text}`}>Build path for {state.bestPick}</div>
        <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Adaptive items</div>
      </div>
      <div className="grid grid-cols-6 gap-3">
        {state.buildPath.slice(0, 6).map((item, index) => <div key={`${item}-${index}`} className="min-w-0 border border-white/10 bg-white/[0.08] p-3 text-center">
          <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${accent.bg} text-xl font-black ${accent.text}`}>{index + 1}</div>
          <div className="mt-2 truncate text-sm font-black uppercase text-white">{item || "-"}</div>
        </div>)}
      </div>
    </motion.section>
  </div>;
}

function LowerThird({ state }: { state: LocalOverlayState; key?: string }) {
  const accent = accentClasses[state.accent];
  return <motion.section initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="absolute bottom-8 left-8 flex max-w-[760px] items-stretch shadow-2xl">
    <div className={`w-3 ${accent.solid}`} />
    <div className="bg-slate-950/92 px-6 py-4">
      <div className={`text-xs font-black uppercase tracking-[0.24em] ${accent.text}`}>{state.lowerTitle}</div>
      <div className="mt-1 text-2xl font-black uppercase leading-tight">{state.lowerSubtitle}</div>
    </div>
  </motion.section>;
}

function Ticker({ state }: { state: LocalOverlayState }) {
  if (!state.showTicker || !state.ticker.length) return null;
  return <div className="absolute inset-x-0 bottom-0 h-8 overflow-hidden border-t border-white/10 bg-black/82">
    <div className="flex h-full animate-[ticker_24s_linear_infinite] items-center whitespace-nowrap text-sm font-black uppercase tracking-[0.18em] text-slate-200">
      {[...state.ticker, ...state.ticker].map((item, index) => <span key={`${item}-${index}`} className="mx-8">{item}</span>)}
    </div>
  </div>;
}

function useTransparentOutputBody() {
  useEffect(() => {
    const previousBody = document.body.style.background;
    const previousHtml = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => {
      document.body.style.background = previousBody;
      document.documentElement.style.background = previousHtml;
    };
  }, []);
}

function buildMapZoneStates(): MapZoneState[] {
  return defaultMapZones();
}

function MapStat({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return <div className="border border-white/10 bg-white/[0.06] px-3 py-2">
    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className={`mt-1 text-lg font-black uppercase leading-tight ${tone}`}>{value}</div>
  </div>;
}

export function MlbbStreamOutput() {
  const { state, matchState } = useOverlayState();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const bg = new URLSearchParams(window.location.search).get("bg") ?? "transparent";

  useTransparentOutputBody();

  return <OutputShell bg={bg}>
    <AnimatePresence>
      {display.activeScene === "draft" && <DraftPanel key="draft" state={display} />}
      {display.activeScene === "matchup" && <DraftPanel key="matchup" state={display} />}
      {display.activeScene === "objective" && <ObjectivePanel key="objective" state={display} />}
      {display.activeScene === "alert" && <AlertPanel key="alert" state={display} />}
      {display.activeScene === "build" && <BuildPanel key="build" state={display} />}
      {(display.activeScene === "draft" || display.activeScene === "matchup") && <LowerThird key="lower-third" state={display} />}
    </AnimatePresence>
    {display.activeScene !== "hidden" && <Ticker state={display} />}
  </OutputShell>;
}

export function MlbbTacticalMapOutput() {
  const { state, matchState } = useOverlayState();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const bg = new URLSearchParams(window.location.search).get("bg") ?? "transparent";
  const [mapRuntime, setMapRuntime] = useState<any>(null);
  const accent = accentClasses[display.accent];
  const match = currentMatch(matchState);
  const mapVisionActive = match?.confidence?.visionTrusted && ["live_hud", "death_replay", "scoreboard"].includes(String(match?.lifecycle?.screen ?? ""));
  const mapMonitor = match?.vision?.signals?.mapMonitor;
  const markers: TacticalMapMarker[] = mapVisionActive
    ? (mapMonitor?.markers ?? match.vision?.minimapMarkers ?? []).filter((marker: TacticalMapMarker) => Number(marker.confidence ?? 0) >= Number(match.confidence.minimum ?? 0.55))
    : [];
  const allyMarkers = markers.filter((marker) => marker.side === "ally" && marker.status !== "last_seen").length;
  const enemyMarkers = markers.filter((marker) => marker.side === "enemy" && marker.status !== "last_seen").length;
  const lastSeenEnemies = markers.filter((marker) => marker.side === "enemy" && marker.status === "last_seen").length;
  const identifiedEnemies = [...new Set(markers.filter((marker) => marker.side === "enemy" && marker.heroName).map((marker) => marker.heroName!))];
  const visibleObjects = mapVisionActive ? (mapMonitor?.objects ?? []).filter((object: any) => object.status === "visible") : [];
  const visibleObjective = visibleObjects.find((object: any) => object.objectType === "lord" || object.objectType === "turtle")?.objectType;

  useTransparentOutputBody();

  useEffect(() => {
    let active = true;
    apiGet<any>("/api/map/runtime").then((runtime) => {
      if (active) setMapRuntime(runtime);
    }).catch(() => {
      if (active) setMapRuntime(null);
    });
    return () => { active = false; };
  }, []);

  return <OutputShell bg={bg}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,.16),transparent_24%),radial-gradient(circle_at_82%_76%,rgba(248,113,113,.13),transparent_24%)]" />
    <div className="relative z-10 grid h-full grid-cols-[minmax(0,1fr)_330px] gap-5 p-6">
      <section className="relative min-w-0">
        <div className="mb-4 flex items-end justify-between gap-5">
          <div>
            <div className={`text-xs font-black uppercase tracking-[0.28em] ${accent.text}`}>MLBB tactical map</div>
            <h1 className="mt-1 text-5xl font-black uppercase leading-none tracking-normal">{display.mapTitle}</h1>
            <p className="mt-2 text-lg font-bold uppercase tracking-[0.12em] text-slate-300">{display.mapSubtitle}</p>
          </div>
          <div className={`border ${accent.border} bg-black/70 px-5 py-3 text-right shadow-xl ${accent.glow}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Focus</div>
            <div className={`text-xl font-black uppercase ${accent.text}`}>{display.mapFocus}</div>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={`relative overflow-hidden border ${accent.border} bg-slate-950/80 p-3 shadow-2xl ${accent.glow}`}>
          <BattlefieldMap
            states={buildMapZoneStates()}
            markers={markers}
            projection={mapRuntime?.projection}
            showOverlay
          />
        </motion.div>
      </section>

      <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
        <div className={`min-h-0 border ${accent.border} bg-slate-950/90 p-4 shadow-2xl ${accent.glow}`}>
          <div className={`text-xs font-black uppercase tracking-[0.26em] ${accent.text}`}>Live formation</div>
          <h2 className="mt-2 line-clamp-5 text-2xl font-black uppercase leading-tight">{display.mapCallout}</h2>
          <div className="mt-4 grid gap-2">
            <MapStat label="Visible allies" value={String(allyMarkers)} tone="text-cyan-200" />
            <MapStat label="Visible enemies" value={String(enemyMarkers)} tone="text-red-200" />
            <MapStat label="Enemy last seen" value={String(lastSeenEnemies)} tone="text-amber-200" />
            <MapStat label="Identified enemies" value={identifiedEnemies.join(" / ") || "-"} tone="text-red-200" />
            <MapStat label="Objective visible" value={visibleObjective ? visibleObjective.toUpperCase() : "-"} tone="text-amber-200" />
            <MapStat label="Pressure" value={display.mapFocus} tone="text-red-200" />
          </div>
        </div>

        <div className="border border-white/10 bg-black/75 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-400">Rotation plan</div>
          <ol className="space-y-2">
            {display.mapPlan.slice(0, 4).map((step, index) => <li key={`${step}-${index}`} className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3">
              <span className={`grid h-8 w-8 place-items-center rounded-full ${accent.bg} text-sm font-black ${accent.text}`}>{index + 1}</span>
              <span className="line-clamp-2 text-sm font-bold leading-snug text-slate-100">{step}</span>
            </li>)}
          </ol>
        </div>
      </aside>
    </div>
  </OutputShell>;
}

function heroInitials(name: string) {
  return name.split(/[\s-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}

function heroKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function useHeroCatalog() {
  const [catalog, setCatalog] = useState<Map<string, HeroVisual>>(new Map());

  useEffect(() => {
    let active = true;
    apiGet<{ success?: boolean; data?: any[] } | any[]>("/api/cache/heroes").then((result) => {
      if (!active) return;
      const heroes = Array.isArray(result) ? result : result.data ?? [];
      const next = new Map<string, HeroVisual>();
      heroes.forEach((hero: any) => {
        const name = String(hero?.name ?? hero?.hero_name ?? hero?.raw?.hero_name ?? "");
        if (!name) return;
        next.set(heroKey(name), {
          name,
          icon: resolveHeroIcon(hero),
          roles: hero?.roles ?? splitTags(hero?.role ?? hero?.raw?.role),
          lanes: hero?.lanes ?? splitTags(hero?.lane ?? hero?.raw?.lane),
          specialties: hero?.specialties ?? splitTags(hero?.speciality ?? hero?.raw?.speciality)
        });
      });
      setCatalog(next);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  return catalog;
}

function splitTags(value: unknown) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function roleTone(role?: string) {
  const normalized = String(role ?? "").toLowerCase();
  if (normalized.includes("tank")) return "bg-sky-500/18 text-sky-100 border-sky-300/35";
  if (normalized.includes("mage")) return "bg-violet-500/18 text-violet-100 border-violet-300/35";
  if (normalized.includes("assassin")) return "bg-red-500/18 text-red-100 border-red-300/35";
  if (normalized.includes("marksman")) return "bg-amber-500/18 text-amber-100 border-amber-300/35";
  if (normalized.includes("support")) return "bg-emerald-500/18 text-emerald-100 border-emerald-300/35";
  return "bg-white/[0.08] text-slate-100 border-white/15";
}

function HeroPortrait({ hero, meta, side, accent, large = false }: { hero: string; meta?: HeroVisual; side: "ally" | "enemy"; accent: Accent; large?: boolean }) {
  const shell = side === "ally" ? "from-cyan-300/35 via-cyan-500/10 to-transparent" : "from-red-300/35 via-red-500/10 to-transparent";
  return <div className={`relative shrink-0 overflow-hidden border border-white/15 bg-slate-900 shadow-xl ${large ? "h-36 w-36 rounded-[28px]" : "h-[82px] w-[82px] rounded-[18px]"}`}>
    <div className={`absolute inset-0 bg-gradient-to-br ${shell}`} />
    {meta?.icon ? <img className="absolute inset-0 h-full w-full object-cover" src={meta.icon} alt={hero} draggable={false} /> : <div className={`absolute inset-0 grid place-items-center ${large ? "text-5xl" : "text-3xl"} font-black ${accentClasses[accent].text}`}>{heroInitials(hero)}</div>}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 py-1 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white">{heroInitials(hero)}</div>
  </div>;
}

function HeroPickCard({ hero, index, side, accent, meta }: { hero: string; index: number; side: "ally" | "enemy"; accent: Accent; meta?: HeroVisual }) {
  const color = side === "ally" ? "border-cyan-300/45 bg-cyan-500/[0.07]" : "border-red-300/45 bg-red-500/[0.07]";
  const role = meta?.roles?.[0] ?? (hero === "-" ? "Pending" : "Hero");
  const lane = meta?.lanes?.[0] ?? ["Roam", "Mid", "Jungle", "Gold", "EXP"][index];
  const specialty = meta?.specialties?.[0] ?? (side === "ally" ? "Synergy" : "Threat");
  return <motion.div initial={{ x: side === "ally" ? -60 : 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: index * 0.06 }} className={`relative min-h-[96px] overflow-hidden border ${color} shadow-xl`}>
    <div className={`absolute inset-y-0 ${side === "ally" ? "left-0 bg-cyan-300" : "right-0 bg-red-300"} w-1.5`} />
    <div className="absolute -right-10 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full bg-white/[0.04]" />
    <div className="grid h-full grid-cols-[92px_minmax(0,1fr)_54px] items-center gap-3 p-2.5">
      <HeroPortrait hero={hero} meta={meta} side={side} accent={accent} />
      <div className={`min-w-0 ${side === "enemy" ? "text-right" : ""}`}>
        <div className={`flex items-center gap-2 ${side === "enemy" ? "justify-end" : ""}`}>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${roleTone(role)}`}>{role}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">{lane}</span>
        </div>
        <div className="mt-2 truncate text-[28px] font-black uppercase leading-none text-white">{hero || "-"}</div>
        <div className="mt-1 truncate text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{specialty}</div>
      </div>
      <div className="grid h-14 w-12 place-items-center border border-white/10 bg-black/35 text-center">
        <div>
          <div className={`text-[10px] font-black uppercase tracking-widest ${accentClasses[accent].text}`}>P{index + 1}</div>
          <div className="text-xl font-black text-white">{index + 1}</div>
        </div>
      </div>
    </div>
  </motion.div>;
}

function pickList(detected: string[]) {
  const picks = detected.map((hero) => hero || "-");
  return [...picks, "-", "-", "-", "-", "-"].slice(0, 5);
}

function BanRow({ label, heroes, side, catalog }: { label: string; heroes: string[]; side: "ally" | "enemy"; catalog: Map<string, HeroVisual> }) {
  const tone = side === "ally" ? "border-cyan-300/30 bg-cyan-500/10 text-cyan-100" : "border-red-300/30 bg-red-500/10 text-red-100";
  return <div className="flex min-w-0 items-center gap-2">
    <span className={`shrink-0 text-xs font-black uppercase tracking-[0.2em] ${side === "ally" ? "text-cyan-200" : "text-red-200"}`}>{label}</span>
    {(heroes.length ? heroes : ["-"]).map((hero, index) => {
      const meta = catalog.get(heroKey(hero));
      return <span key={`${side}-ban-${hero}-${index}`} className={`flex min-h-10 items-center gap-2 border px-2.5 py-1.5 text-sm font-black uppercase ${tone}`}>
        {meta?.icon && <img className="h-7 w-7 rounded-full object-cover" src={meta.icon} alt="" />}
        {hero}
      </span>;
    })}
  </div>;
}

function DraftContextRow({ state }: { state: LocalOverlayState }) {
  const facts = [
    state.selectedLane ? `My lane: ${state.selectedLane}` : "",
    state.selfSlot ? `My position: ${state.selfSlot}` : "",
    state.firstPickSide,
    state.detectedSpell ? `My spell: ${state.detectedSpell}` : "",
    state.recommendedSpell ? `Recommend spell: ${state.recommendedSpell}` : "",
    state.allyLanes.length ? `Ally lanes: ${state.allyLanes.join(" / ")}` : "",
  ].filter(Boolean);
  return <div className="flex flex-wrap justify-center gap-2">
    {(facts.length ? facts : ["Draft context pending"]).map((fact) => <span key={fact} className="border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-200">{fact}</span>)}
  </div>;
}

export function MlbbTextPanelOutput() {
  const { state, matchState } = useOverlayState();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const bg = new URLSearchParams(window.location.search).get("bg") ?? "transparent";
  const accent = accentClasses[display.accent];
  useTransparentOutputBody();

  return <OutputShell bg={bg}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,rgba(34,211,238,.14),transparent_24%),radial-gradient(circle_at_78%_70%,rgba(124,58,237,.16),transparent_25%)]" />
    <div className="relative grid h-full place-items-center p-10">
      <motion.section initial={{ opacity: 0, y: 55 }} animate={{ opacity: 1, y: 0 }} className={`w-[min(1000px,84vw)] border ${accent.border} bg-slate-950/92 p-8 shadow-2xl ${accent.glow}`}>
        <div className="flex items-center gap-3">
          <div className={`grid h-12 w-12 place-items-center rounded-full ${accent.bg} ${accent.text}`}><MessageSquareText className="h-6 w-6" /></div>
          <div className={`text-sm font-black uppercase tracking-[0.28em] ${accent.text}`}>{display.textKicker}</div>
        </div>
        <h1 className="mt-5 text-6xl font-black uppercase leading-none tracking-normal">{display.textTitle}</h1>
        <p className="mt-5 text-2xl font-bold leading-snug text-slate-200">{display.textBody}</p>
        <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-4 text-sm font-black uppercase tracking-[0.22em] text-slate-400">
          <span>{display.textFooter}</span>
          <span className={accent.text}>{display.objective} {display.objectiveTimer}</span>
        </div>
      </motion.section>
    </div>
  </OutputShell>;
}

export function MlbbCounterOutput() {
  const { state, matchState } = useOverlayState();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const bg = new URLSearchParams(window.location.search).get("bg") ?? "transparent";
  const accent = accentClasses[display.accent];
  useTransparentOutputBody();

  return <OutputShell bg={bg}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,.18),transparent_30%)]" />
    <div className="relative grid h-full place-items-center p-8">
      <motion.section initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className={`grid w-[min(1040px,86vw)] grid-cols-[360px_minmax(0,1fr)] overflow-hidden border ${accent.border} bg-slate-950/92 shadow-2xl ${accent.glow}`}>
        <div className={`grid place-items-center border-r ${accent.border} ${accent.bg} p-8 text-center`}>
          <div>
            <Hash className={`mx-auto mb-3 h-12 w-12 ${accent.text}`} />
            <div className="text-[150px] font-black leading-none tracking-normal">{display.counterValue}</div>
            <div className={`mt-1 text-sm font-black uppercase tracking-[0.28em] ${accent.text}`}>{display.counterTitle}</div>
          </div>
        </div>
        <div className="p-7">
          <div className={`text-sm font-black uppercase tracking-[0.26em] ${accent.text}`}>Live counter</div>
          <h1 className="mt-2 text-5xl font-black uppercase leading-tight">{display.counterLabel}</h1>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {display.counterItems.slice(0, 9).map((item, index) => <div key={`${item}-${index}`} className="min-h-20 border border-white/10 bg-white/[0.06] p-3">
              <div className={`text-2xl font-black ${accent.text}`}>{String(index + 1).padStart(2, "0")}</div>
              <div className="mt-1 line-clamp-2 text-sm font-bold uppercase leading-tight text-slate-100">{item}</div>
            </div>)}
          </div>
        </div>
      </motion.section>
    </div>
  </OutputShell>;
}

export function MlbbHeroPicksOutput() {
  const { state, matchState } = useOverlayState();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const bg = new URLSearchParams(window.location.search).get("bg") ?? "transparent";
  const accent = accentClasses[display.accent];
  const heroCatalog = useHeroCatalog();
  const ally = pickList(display.allyPicks);
  const enemy = pickList(display.enemyPicks);
  const bestMeta = heroCatalog.get(heroKey(display.bestPick));
  useTransparentOutputBody();

  return <OutputShell bg={bg}>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_20%,rgba(34,211,238,.16),transparent_24%),radial-gradient(circle_at_85%_76%,rgba(248,113,113,.14),transparent_24%)]" />
    <div className="relative z-10 grid h-full grid-rows-[auto_auto_minmax(0,1fr)] gap-5 p-6">
      <header className={`grid grid-cols-[1fr_auto_1fr] items-center border ${accent.border} bg-slate-950/90 px-6 py-4 shadow-2xl ${accent.glow}`}>
        <div>
          <div className={`text-xs font-black uppercase tracking-[0.28em] ${accent.text}`}>MLBB draft board</div>
          <h1 className="mt-1 text-4xl font-black uppercase leading-none">{display.picksTitle}</h1>
        </div>
        <div className="px-8 text-center">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{display.matchPhase}</div>
          <div className="mt-1 text-2xl font-black">{display.timer}</div>
        </div>
        <div className="text-right text-lg font-black uppercase tracking-[0.16em] text-slate-300">{display.picksSubtitle}</div>
      </header>
      <section className={`flex flex-wrap items-center justify-between gap-5 border ${accent.border} bg-slate-950/85 px-5 py-3`}>
        <BanRow label="Ally bans" heroes={display.allyBans} side="ally" catalog={heroCatalog} />
        <DraftContextRow state={display} />
        <BanRow label="Enemy bans" heroes={display.enemyBans} side="enemy" catalog={heroCatalog} />
      </section>
      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_380px_minmax(0,1fr)] gap-5">
        <div className="space-y-2.5">
          <div className="text-sm font-black uppercase tracking-[0.24em] text-cyan-200">{display.teamBlue}</div>
          {ally.map((hero, index) => <div key={`ally-${hero}-${index}`}><HeroPickCard hero={hero} index={index} side="ally" accent={display.accent} meta={heroCatalog.get(heroKey(hero))} /></div>)}
        </div>
        <div className={`relative flex flex-col justify-between overflow-hidden border ${accent.border} bg-black/75 p-5 text-center shadow-xl ${accent.glow}`}>
          <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-cyan-500/12 to-transparent" />
          <div>
            <div className={`text-xs font-black uppercase tracking-[0.24em] ${accent.text}`}>Best recommendation</div>
            <div className="mx-auto mt-4 flex justify-center">
              <HeroPortrait hero={display.bestPick} meta={bestMeta} side="ally" accent={display.accent} large />
            </div>
            <div className="mt-4 text-5xl font-black uppercase leading-none">{display.bestPick}</div>
            <div className="mt-3 flex justify-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${roleTone(bestMeta?.roles?.[0])}`}>{bestMeta?.roles?.[0] ?? "Recommended"}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-slate-300">{bestMeta?.lanes?.[0] ?? "Flex"}</span>
            </div>
            <div className="mx-auto mt-5 grid h-24 w-24 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-4xl font-black">{display.confidence}</div>
          </div>
          <div>
            <p className="text-base font-bold leading-snug text-slate-300">{display.reason}</p>
            {display.recommendedSpell && <p className="mt-3 border border-cyan-300/25 bg-cyan-500/10 p-3 text-sm font-bold text-cyan-100">{display.recommendedSpell}: {display.spellReason}</p>}
          </div>
        </div>
        <div className="space-y-2.5">
          <div className="text-right text-sm font-black uppercase tracking-[0.24em] text-red-200">{display.teamRed}</div>
          {enemy.map((hero, index) => <div key={`enemy-${hero}-${index}`}><HeroPickCard hero={hero} index={index} side="enemy" accent={display.accent} meta={heroCatalog.get(heroKey(hero))} /></div>)}
        </div>
      </section>
    </div>
  </OutputShell>;
}

type NativeSurface = "waiting" | "draft" | "live" | "scoreboard";
type DetectedEquipmentFact = {
  itemId: number;
  itemName: string;
  side: "ally" | "enemy";
  row: number;
  slot: number;
  confidence: number;
};

function selectNativeSurface(matchState: any): NativeSurface {
  const match = currentMatch(matchState);
  if (currentDraft(match)) return "draft";
  if (!match?.confidence?.visionTrusted) return "waiting";
  if (match.lifecycle?.screen === "scoreboard") return "scoreboard";
  return ["live_hud", "death_replay"].includes(String(match.lifecycle?.screen ?? "")) ? "live" : "waiting";
}

function DraftNativeOverlay({ state, heroCatalog }: { state: LocalOverlayState; heroCatalog: Map<string, HeroVisual> }) {
  const bestMeta = heroCatalog.get(heroKey(state.bestPick));
  const hasRecommendation = state.bestPick !== "Awaiting detected picks";
  const spellName = state.recommendedSpell || state.detectedSpell;
  const spellIcon = resolveSpellIcon(spellName);

  return <motion.section
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className="pointer-events-none absolute z-10"
    style={{ left: "18.2%", top: "13%", width: "61.6%", height: "56.5%" }}
  >
    <div className="absolute inset-x-[10%] top-0 flex justify-center">
      {state.firstPickSide && <div className="min-w-[240px] border-x border-b border-[#d6ac67]/45 bg-[#101e35]/66 px-6 py-2 text-center text-[12px] font-bold uppercase text-[#f8de9c] backdrop-blur-[2px]">
        {state.firstPickSide}
      </div>}
    </div>
    <div className="absolute inset-x-[4%] bottom-0 overflow-hidden border border-[#52cddf]/45 bg-[#061326]/78 shadow-[0_15px_46px_rgba(0,0,0,.38)] backdrop-blur-[3px]" style={{ clipPath: "polygon(16px 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%, 0 16px)" }}>
      <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,transparent,#53d4ec_22%,#f0c878_50%,#53d4ec_78%,transparent)]" />
      <div className="grid min-h-[112px] grid-cols-[100px_minmax(0,1fr)_210px] items-center gap-4 px-5 py-4">
        <div className="grid place-items-center">
          {hasRecommendation ? <HeroPortrait hero={state.bestPick} meta={bestMeta} side="ally" accent="cyan" /> : <div className="grid h-[76px] w-[76px] place-items-center border border-cyan-200/35 bg-[#122743]/70">
            <Swords className="h-7 w-7 text-cyan-100" />
          </div>}
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase text-[#f0cc81]">Recommended pick</div>
          <div className="mt-1 truncate text-[32px] font-black uppercase leading-none text-white">{hasRecommendation ? state.bestPick : "Pending"}</div>
          <div className="mt-2 flex gap-2 text-[11px] font-semibold uppercase text-cyan-100/90">
            {state.selectedLane && <span className="border border-cyan-200/25 bg-cyan-400/10 px-2 py-1">{state.selectedLane} lane</span>}
            {state.selfSlot && <span className="border border-cyan-200/25 bg-cyan-400/10 px-2 py-1">{state.selfSlot}</span>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-l border-white/10 pl-5">
          {spellIcon && spellName && <img src={spellIcon} className="h-11 w-11 rounded-full border border-[#ecd08a]/60 object-cover" alt="" />}
          <div className="min-w-0 text-right">
            <div className="text-[10px] font-bold uppercase text-slate-300">Battle spell</div>
            <div className="mt-1 truncate text-[18px] font-black uppercase text-cyan-100">{spellName || "Pending"}</div>
            <div className="mt-2 text-[11px] font-bold uppercase text-[#edcc83]">Score {hasRecommendation ? state.confidence : "-"}</div>
          </div>
        </div>
      </div>
    </div>
  </motion.section>;
}

function NativeLiveOverlay({ state }: { state: LocalOverlayState }) {
  if (!state.warning && state.objectiveTimer === "--:--") return null;
  return <div className="pointer-events-none absolute left-1/2 top-[9.5%] w-[min(620px,46vw)] -translate-x-1/2">
    <motion.section initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden border border-[#d0ad6c]/45 bg-[#07152b]/76 shadow-[0_14px_34px_rgba(0,0,0,.3)] backdrop-blur-[3px]">
      <div className="h-[2px] bg-[linear-gradient(90deg,transparent,#4dcfe4_20%,#eac676_50%,#4dcfe4_80%,transparent)]" />
      <div className="flex min-h-16 items-center gap-4 px-5 py-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#e7c878]/55 bg-[#122947]/85 text-[#f4d18b]"><Timer className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase text-[#efcf91]">{state.objective} {state.objectiveTimer !== "--:--" ? state.objectiveTimer : ""}</div>
          <div className="mt-1 truncate text-[17px] font-bold uppercase text-white">{state.warning || state.textTitle}</div>
        </div>
      </div>
    </motion.section>
  </div>;
}

function EquipmentFactRow({ label, items, side }: { label: string; items: DetectedEquipmentFact[]; side: "ally" | "enemy" }) {
  const tone = side === "ally" ? "text-cyan-100 border-cyan-200/30" : "text-rose-100 border-rose-200/30";
  return <div className="flex items-center gap-3">
    <div className={`w-[82px] shrink-0 text-[11px] font-bold uppercase ${tone.split(" ")[0]}`}>{label}</div>
    <div className="flex min-w-0 gap-2">
      {items.slice(0, 6).map((item) => <div key={`${side}-${item.row}-${item.slot}-${item.itemId}`} className={`flex h-12 min-w-[126px] items-center gap-2 border bg-[#0b182e]/78 px-2 ${tone}`}>
        <img className="h-9 w-9 shrink-0 object-cover" src={`/api/vision/equipment/icon/${item.itemId}`} alt="" />
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase text-white">{item.itemName}</div>
          <div className="text-[10px] font-semibold text-slate-300">{Math.round(item.confidence * 100)}%</div>
        </div>
      </div>)}
    </div>
  </div>;
}

function NativeScoreboardOverlay({ matchState }: { matchState: any }) {
  const match = currentMatch(matchState);
  const signals = match?.vision?.signals;
  const ally = (signals?.allyEquipment ?? []) as DetectedEquipmentFact[];
  const enemy = (signals?.enemyEquipment ?? []) as DetectedEquipmentFact[];
  if (!ally.length && !enemy.length) return null;
  return <div className="pointer-events-none absolute bottom-[22.5%] left-1/2 min-w-[560px] max-w-[92vw] -translate-x-1/2">
    <motion.section initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden border border-[#d3b06d]/45 bg-[#071326]/84 px-5 py-4 shadow-[0_12px_36px_rgba(0,0,0,.38)] backdrop-blur-[4px]">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,transparent,#4bd2e8_22%,#f1c875_50%,#4bd2e8_78%,transparent)]" />
      <div className="mb-3 text-center text-[11px] font-bold uppercase text-[#f1d28c]">Detected Equipment</div>
      <div className="space-y-2">
        {ally.length ? <EquipmentFactRow label="Ally" items={ally} side="ally" /> : null}
        {enemy.length ? <EquipmentFactRow label="Enemy" items={enemy} side="enemy" /> : null}
      </div>
    </motion.section>
  </div>;
}

function NativeGameOverlay({ state, surface, heroCatalog, matchState }: { state: LocalOverlayState; surface: NativeSurface; heroCatalog: Map<string, HeroVisual>; matchState: any }) {
  if (surface === "draft") return <DraftNativeOverlay state={state} heroCatalog={heroCatalog} />;
  if (surface === "live") return <NativeLiveOverlay state={state} />;
  if (surface === "scoreboard") return <NativeScoreboardOverlay matchState={matchState} />;
  return null;
}

function mediaUrl(slot: OverlayMediaSlotId, updatedAt: string) {
  return `/api/overlay/media/${slot}/file?v=${encodeURIComponent(updatedAt)}`;
}

function parseKeyColor(color: string) {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color : "#00ff00";
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function ChromaKeyCanvas({ source, slot }: { source: string; slot: OverlayMediaSlot }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let animation = 0;
    let disposed = false;
    const media = slot.mediaType === "video" ? document.createElement("video") : new Image();
    const key = parseKeyColor(slot.chromaKey.color);

    function renderFrame() {
      if (disposed || !canvasRef.current) return;
      const bounds = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(bounds.width * scale));
      const height = Math.max(1, Math.round(bounds.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const naturalWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
      const naturalHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
      if (!naturalWidth || !naturalHeight) return;
      const fit = Math.min(width / naturalWidth, height / naturalHeight);
      const drawWidth = naturalWidth * fit;
      const drawHeight = naturalHeight * fit;
      const left = (width - drawWidth) / 2;
      const top = (height - drawHeight) / 2;
      context.clearRect(0, 0, width, height);
      context.drawImage(media, left, top, drawWidth, drawHeight);
      const pixels = context.getImageData(0, 0, width, height);
      const data = pixels.data;
      const tolerance = slot.chromaKey.tolerance;
      const softness = Math.max(1, slot.chromaKey.softness);
      for (let index = 0; index < data.length; index += 4) {
        const distance = Math.sqrt(
          (data[index] - key[0]) ** 2
          + (data[index + 1] - key[1]) ** 2
          + (data[index + 2] - key[2]) ** 2,
        );
        if (distance <= tolerance) {
          data[index + 3] = 0;
        } else if (distance < tolerance + softness) {
          data[index + 3] = Math.round(data[index + 3] * ((distance - tolerance) / softness));
        }
      }
      context.putImageData(pixels, 0, 0);
    }

    if (media instanceof HTMLVideoElement) {
      media.muted = true;
      media.loop = true;
      media.autoplay = true;
      media.playsInline = true;
      media.src = source;
      media.addEventListener("loadeddata", () => void media.play().catch(() => undefined));
      const drawVideo = () => {
        renderFrame();
        animation = window.requestAnimationFrame(drawVideo);
      };
      media.addEventListener("playing", drawVideo, { once: true });
    } else {
      media.src = source;
      media.addEventListener("load", renderFrame, { once: true });
    }

    const resize = new ResizeObserver(renderFrame);
    resize.observe(canvas);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animation);
      resize.disconnect();
      if (media instanceof HTMLVideoElement) {
        media.pause();
        media.src = "";
      }
    };
  }, [source, slot.chromaKey.color, slot.chromaKey.softness, slot.chromaKey.tolerance, slot.mediaType]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}

function StudioMedia({ id, config }: { id: OverlayMediaSlotId; config: OverlayMediaConfig }) {
  const slot = config[id];
  if (!slot.enabled || !slot.fileName) return null;
  const source = mediaUrl(id, config.updatedAt);
  if (slot.chromaKey.enabled) return <ChromaKeyCanvas source={source} slot={slot} />;
  if (slot.mediaType === "video") return <video key={source} src={source} autoPlay loop muted playsInline className="h-full w-full object-contain" />;
  return <img src={source} alt="" className="h-full w-full object-contain" />;
}

function ObsStudioBand({ config }: { config: OverlayMediaConfig }) {
  if (!config.bandEnabled) return null;
  const hasLogo = config.logo.enabled && Boolean(config.logo.fileName);
  return <section
    data-testid="obs-studio-band"
    className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
    style={{ height: "19.7%", backgroundColor: `rgba(0, 0, 0, ${config.bandOpacity})` }}
  >
    <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,#2fd9f2_0%,#2fd9f2_15%,transparent_30%,transparent_100%)]" />
    <div className="absolute inset-y-[10%] left-[1.5%] w-[17%]">
      {hasLogo ? <StudioMedia id="logo" config={config} /> : <div className="flex h-full items-center border-r border-cyan-300/18 px-5">
        <div>
          <div className="text-[10px] font-semibold uppercase text-cyan-200">Ranked Stream</div>
          <div className="mt-1 text-[26px] font-black uppercase leading-[0.92] text-white">MLBB<br />Co-Pilot</div>
        </div>
      </div>}
    </div>
    <div className="absolute inset-y-[10%] left-[23%] w-[34%]">
      <StudioMedia id="sponsor" config={config} />
    </div>
  </section>;
}

export function MlbbLiveOutput() {
  const { state, matchState } = useOverlayState();
  const { config: mediaConfig } = useOverlayMedia();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const heroCatalog = useHeroCatalog();
  const surface = selectNativeSurface(matchState);
  const search = new URLSearchParams(window.location.search);
  const bg = search.get("bg") ?? "transparent";
  const previewOnly = search.get("preview") === "1";
  useTransparentOutputBody();

  useEffect(() => {
    if (previewOnly) return;
    const store = useCaptureRuntimeStore.getState();
    if (!store.running) {
      store.setSelectedSource("obs");
      startSelectedCaptureRuntime();
    }
    return () => {
      if (useCaptureRuntimeStore.getState().sourceMode === "obs") stopCaptureRuntime();
    };
  }, [previewOnly]);

  return <OutputShell bg={bg}>
    <CaptureRuntimeHost />
    <NativeGameOverlay state={display} surface={surface} heroCatalog={heroCatalog} matchState={matchState} />
    <ObsStudioBand config={mediaConfig} />
  </OutputShell>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
    {children}
  </label>;
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input w-full ${props.className ?? ""}`} />;
}

function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="number" className={`input w-full ${props.className ?? ""}`} />;
}

function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input min-h-28 w-full resize-y ${props.className ?? ""}`} />;
}

function MediaSlotControl({
  id,
  title,
  media,
}: {
  id: OverlayMediaSlotId;
  title: string;
  media: ReturnType<typeof useOverlayMedia>;
}) {
  const slot = media.config[id];

  function updateSlot(next: Partial<OverlayMediaSlot>) {
    void media.patch({ [id]: { ...slot, ...next } } as Partial<OverlayMediaConfig>);
  }

  function updateKey(next: Partial<OverlayMediaSlot["chromaKey"]>) {
    updateSlot({ chromaKey: { ...slot.chromaKey, ...next } });
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void media.upload(id, file);
    event.target.value = "";
  }

  return <div className="border border-white/10 bg-black/20 p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-black uppercase text-white"><Film className="h-4 w-4 text-cyan-200" />{title}</div>
      <button
        className={`min-h-9 border px-3 text-xs font-bold uppercase ${slot.enabled ? "border-cyan-300/35 bg-cyan-500/10 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300"}`}
        onClick={() => updateSlot({ enabled: !slot.enabled })}
      >
        {slot.enabled ? "Shown" : "Hidden"}
      </button>
    </div>
    <div className="mb-3 truncate text-xs text-slate-400">{slot.fileName || "No media selected"}</div>
    {slot.fileName && <div className="mb-3 h-20 overflow-hidden border border-white/10 bg-black">
      <StudioMedia id={id} config={media.config} />
    </div>}
    <div className="mb-4 flex gap-2">
      <label className="btn flex min-h-10 cursor-pointer items-center bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25">
        <Upload className="mr-2 h-4 w-4" />{media.busy === id ? "Loading" : "Add Media"}
        <input type="file" accept=".mp4,.webm,.png,.webp,video/mp4,video/webm,image/png,image/webp" className="sr-only" onChange={selectFile} disabled={Boolean(media.busy)} />
      </label>
      {slot.fileName && <button className="btn flex min-h-10 items-center bg-white/5 text-slate-200 hover:bg-red-500/15 hover:text-red-100" onClick={() => void media.remove(id)} disabled={Boolean(media.busy)}>
        <Trash2 className="mr-2 h-4 w-4" />Remove
      </button>}
    </div>
    <label className="mb-3 flex min-h-10 items-center justify-between border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-slate-200">
      Chroma key background
      <input type="checkbox" checked={slot.chromaKey.enabled} onChange={(event) => updateKey({ enabled: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
    </label>
    <div className="grid gap-3 sm:grid-cols-[100px_minmax(0,1fr)]">
      <Field label="Key color">
        <input type="color" value={slot.chromaKey.color} onChange={(event) => updateKey({ color: event.target.value })} className="input h-11 w-full cursor-pointer p-1" />
      </Field>
      <Field label={`Tolerance ${slot.chromaKey.tolerance}`}>
        <input type="range" min={0} max={255} value={slot.chromaKey.tolerance} onChange={(event) => updateKey({ tolerance: Number(event.target.value) })} className="mt-3 w-full accent-cyan-400" />
      </Field>
      <div />
      <Field label={`Edge soften ${slot.chromaKey.softness}`}>
        <input type="range" min={0} max={120} value={slot.chromaKey.softness} onChange={(event) => updateKey({ softness: Number(event.target.value) })} className="mt-3 w-full accent-cyan-400" />
      </Field>
    </div>
  </div>;
}

export function MlbbStreamControl() {
  const { state, matchState, patch, saving } = useOverlayState();
  const media = useOverlayMedia();
  const display = useMemo(() => getDisplayState(state, matchState), [state, matchState]);
  const liveOutputUrl = `${window.location.origin}/mlbb-live-output`;
  const outputUrl = `${window.location.origin}/mlbb-output`;
  const mapOutputUrl = `${window.location.origin}/mlbb-map-output`;
  const textOutputUrl = `${window.location.origin}/mlbb-text-output`;
  const counterOutputUrl = `${window.location.origin}/mlbb-counter-output`;
  const picksOutputUrl = `${window.location.origin}/mlbb-picks-output`;

  return <main className="mx-auto max-w-6xl space-y-4">
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-950/80 p-4">
      <div className="mr-auto">
        <h1 className="text-2xl font-black uppercase tracking-normal">MLBB Stream Pack</h1>
        <p className="text-sm text-slate-400">Output facts are read-only and arrive from current confidence-scored detection.</p>
      </div>
      <div className={`flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold ${currentMatch(matchState) ? "text-emerald-200" : "text-slate-300"}`}>
        <Radio className="h-4 w-4" />{currentMatch(matchState) ? "Detector live" : "Waiting for detector"}
      </div>
      <button className="btn bg-white/10 hover:bg-white/15" onClick={() => navigator.clipboard?.writeText(liveOutputUrl)}><Copy className="mr-2 inline h-4 w-4" />Copy Live URL</button>
    </section>

    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card p-5">
        <h2 className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Detected state</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MapStat label="Screen" value={display.matchPhase} />
          <MapStat label="Draft fact confidence" value={display.picksSubtitle} tone="text-cyan-200" />
          <MapStat label="Callout" value={display.textTitle} tone="text-amber-200" />
          <MapStat label="Output surface" value={selectNativeSurface(matchState)} tone="text-emerald-200" />
          <MapStat label="My lane" value={display.selectedLane || "Pending"} tone="text-cyan-200" />
          <MapStat label="Pick order" value={display.firstPickSide || "Pending"} tone="text-amber-200" />
          <MapStat label="My position" value={display.selfSlot || "Pending"} tone="text-emerald-200" />
          <MapStat label="Detected spell" value={display.detectedSpell || "Pending"} tone="text-cyan-200" />
          <MapStat label="Recommended spell" value={display.recommendedSpell || "Pending"} tone="text-emerald-200" />
          <MapStat label="Ally lanes" value={display.allyLanes.join(" / ") || "Pending"} tone="text-cyan-200" />
        </div>
        <div className="mt-5 border border-white/10 bg-black/25 p-4">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Confirmed draft identities</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...display.allyPicks, ...display.enemyPicks, ...display.allyBans, ...display.enemyBans].filter(Boolean).length
              ? [...display.allyPicks, ...display.enemyPicks, ...display.allyBans, ...display.enemyBans].filter(Boolean).map((hero) => <span key={hero} className="border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-sm font-bold">{hero}</span>)
              : <span className="text-sm text-slate-400">No icon has crossed the detection gate.</span>}
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">OBS sources</h2>
          {[
            ["Live director", liveOutputUrl],
            ["Main", outputUrl],
            ["Map", mapOutputUrl],
            ["Text", textOutputUrl],
            ["Counter", counterOutputUrl],
            ["Picks", picksOutputUrl],
          ].map(([label, value]) => <div key={label} className="mb-3">
            <div className="mb-1 text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
            <input className="input w-full text-sm" readOnly value={value} />
          </div>)}
        </div>
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Presentation</h2>
          <select className="input w-full" value={state.accent} onChange={(event) => void patch({ accent: event.target.value as Accent })}>
            {Object.keys(accentClasses).map((accent) => <option key={accent} value={accent}>{accent}</option>)}
          </select>
          <p className="mt-3 text-xs text-slate-400">{saving ? "Saving presentation." : "Detected graphics remain fact-driven; branding media is configured below."}</p>
        </div>
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">OBS lower band</h2>
          <button
            className={`mb-4 min-h-11 w-full border px-3 text-left font-bold ${media.config.bandEnabled ? "border-cyan-300/35 bg-cyan-500/10 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300"}`}
            onClick={() => void media.patch({ bandEnabled: !media.config.bandEnabled })}
          >
            {media.config.bandEnabled ? "Brand and sponsor band visible" : "Band hidden"}
          </button>
          <Field label={`Band opacity ${Math.round(media.config.bandOpacity * 100)}%`}>
            <input type="range" min={0} max={100} value={Math.round(media.config.bandOpacity * 100)} onChange={(event) => void media.patch({ bandOpacity: Number(event.target.value) / 100 })} className="mt-2 w-full accent-cyan-400" />
          </Field>
          <div className="mt-4 grid gap-3">
            <MediaSlotControl id="logo" title="My logo" media={media} />
            <MediaSlotControl id="sponsor" title="Sponsor" media={media} />
          </div>
          {media.error && <p className="mt-3 border border-red-300/30 bg-red-500/10 p-2 text-xs font-semibold text-red-100">{media.error}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
            <a className="border border-white/10 bg-white/5 px-3 py-2 text-center text-slate-200 hover:bg-white/10" href="/mlbb-live-output?bg=black&preview=1" target="_blank">Preview black</a>
            <a className="border border-white/10 bg-white/5 px-3 py-2 text-center text-slate-200 hover:bg-white/10" href="/mlbb-live-output?bg=green&preview=1" target="_blank">Preview green key</a>
          </div>
        </div>
      </div>
    </section>
  </main>;

  function reset() {
    void patch(defaultState);
  }

  function setLines(key: "ticker" | "buildPath" | "mapPlan" | "counterItems" | "allyPicks" | "enemyPicks", value: string) {
    void patch({ [key]: value.split("\n").map((line) => line.trim()).filter(Boolean) } as Partial<LocalOverlayState>);
  }

  return <main className="mx-auto max-w-7xl space-y-4">
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-950/80 p-4">
      <div className="mr-auto">
        <h1 className="text-2xl font-black uppercase tracking-normal">MLBB Stream Pack Control</h1>
        <p className="text-sm text-slate-400">Unified local OBS outputs for draft graphics, alerts, builds, and tactical map formations.</p>
      </div>
      <div className={`flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold ${saving ? "text-amber-200" : "text-emerald-200"}`}>
        <Radio className="h-4 w-4" />{saving ? "Saving" : "Local live"}
      </div>
      <button className="btn bg-white/10 hover:bg-white/15" onClick={() => navigator.clipboard?.writeText(liveOutputUrl)}><Copy className="mr-2 inline h-4 w-4" />Copy Live URL</button>
      <button className="btn bg-white/10 hover:bg-white/15" onClick={() => navigator.clipboard?.writeText(outputUrl)}><Copy className="mr-2 inline h-4 w-4" />Copy Main URL</button>
      <button className="btn bg-white/10 hover:bg-white/15" onClick={() => navigator.clipboard?.writeText(mapOutputUrl)}><Copy className="mr-2 inline h-4 w-4" />Copy Map URL</button>
      <button className="btn bg-white/10 hover:bg-white/15" onClick={() => navigator.clipboard?.writeText(picksOutputUrl)}><Copy className="mr-2 inline h-4 w-4" />Copy Picks URL</button>
      <button className="btn bg-white/10 hover:bg-white/15" onClick={reset}><RotateCcw className="mr-2 inline h-4 w-4" />Reset</button>
    </section>

    <section className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Take scene</h2>
          <div className="grid grid-cols-2 gap-2">
            {scenes.map(({ id, label, icon: Icon }) => <button key={id} className={`min-h-16 rounded-lg border px-3 text-left font-black uppercase transition ${state.activeScene === id ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`} onClick={() => void patch({ activeScene: id })}>
              <Icon className="mb-1 h-4 w-4" />{label}
            </button>)}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">OBS sources</h2>
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Live director</div>
          <input className="input w-full text-sm" readOnly value={liveOutputUrl} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-live-output" target="_blank">Open live</a>
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-live-output?scene=map" target="_blank">Force map</a>
          </div>
          <div className="mb-3 mt-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Main graphics</div>
          <input className="input w-full text-sm" readOnly value={outputUrl} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-output" target="_blank">Open output</a>
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-output?bg=green" target="_blank">Green key</a>
          </div>
          <div className="mb-3 mt-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Tactical map</div>
          <input className="input w-full text-sm" readOnly value={mapOutputUrl} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-map-output" target="_blank">Open map</a>
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-map-output?bg=green" target="_blank">Green key</a>
          </div>
          <div className="mb-3 mt-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Text panel</div>
          <input className="input w-full text-sm" readOnly value={textOutputUrl} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-text-output" target="_blank">Open text</a>
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-text-output?bg=green" target="_blank">Green key</a>
          </div>
          <div className="mb-3 mt-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Counter</div>
          <input className="input w-full text-sm" readOnly value={counterOutputUrl} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-counter-output" target="_blank">Open counter</a>
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-counter-output?bg=green" target="_blank">Green key</a>
          </div>
          <div className="mb-3 mt-5 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Hero picks</div>
          <input className="input w-full text-sm" readOnly value={picksOutputUrl} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-picks-output" target="_blank">Open picks</a>
            <a className="rounded-lg bg-white/5 px-3 py-2 text-center font-bold text-slate-200 hover:bg-white/10" href="/mlbb-picks-output?bg=green" target="_blank">Green key</a>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Match</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Blue team"><TextInput value={state.teamBlue} onChange={(event) => void patch({ teamBlue: event.target.value })} /></Field>
            <Field label="Red team"><TextInput value={state.teamRed} onChange={(event) => void patch({ teamRed: event.target.value })} /></Field>
            <Field label="Blue score"><NumberInput value={state.blueScore} onChange={(event) => void patch({ blueScore: Number(event.target.value) })} /></Field>
            <Field label="Red score"><NumberInput value={state.redScore} onChange={(event) => void patch({ redScore: Number(event.target.value) })} /></Field>
            <Field label="Phase"><TextInput value={state.matchPhase} onChange={(event) => void patch({ matchPhase: event.target.value })} /></Field>
            <Field label="Timer"><TextInput value={state.timer} onChange={(event) => void patch({ timer: event.target.value })} /></Field>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Draft call</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Best pick"><TextInput value={state.bestPick} placeholder={display.bestPick} onChange={(event) => void patch({ bestPick: event.target.value })} /></Field>
            <Field label="Score"><NumberInput value={state.confidence} min={0} max={100} onChange={(event) => void patch({ confidence: Number(event.target.value) })} /></Field>
          </div>
          <div className="mt-3"><Field label="Reason"><TextArea value={state.reason} onChange={(event) => void patch({ reason: event.target.value })} /></Field></div>
        </div>

        <div className="card p-4">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Objective and alert</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Objective"><TextInput value={state.objective} onChange={(event) => void patch({ objective: event.target.value })} /></Field>
            <Field label="Countdown"><TextInput value={state.objectiveTimer} onChange={(event) => void patch({ objectiveTimer: event.target.value })} /></Field>
          </div>
          <div className="mt-3"><Field label="Warning"><TextArea value={state.warning} placeholder={display.warning || "Map stable"} onChange={(event) => void patch({ warning: event.target.value })} /></Field></div>
        </div>

        <div className="card p-4">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Style and ticker</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Accent">
              <select className="input w-full" value={state.accent} onChange={(event) => void patch({ accent: event.target.value as Accent })}>
                {Object.keys(accentClasses).map((accent) => <option key={accent} value={accent}>{accent}</option>)}
              </select>
            </Field>
            <Field label="Ticker">
              <button className={`min-h-11 w-full rounded-lg border px-3 text-left font-bold ${state.showTicker ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100" : "border-white/10 bg-white/5 text-slate-300"}`} onClick={() => void patch({ showTicker: !state.showTicker })}>{state.showTicker ? "Visible" : "Hidden"}</button>
            </Field>
          </div>
          <div className="mt-3"><Field label="Ticker lines"><TextArea value={state.ticker.join("\n")} onChange={(event) => setLines("ticker", event.target.value)} /></Field></div>
        </div>

        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Lower third and build</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Lower title"><TextInput value={state.lowerTitle} onChange={(event) => void patch({ lowerTitle: event.target.value })} /></Field>
              <Field label="Lower subtitle"><TextInput value={state.lowerSubtitle} onChange={(event) => void patch({ lowerSubtitle: event.target.value })} /></Field>
            </div>
            <Field label="Build path"><TextArea value={state.buildPath.join("\n")} onChange={(event) => setLines("buildPath", event.target.value)} /></Field>
          </div>
        </div>

        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Tactical map formation</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Map title"><TextInput value={state.mapTitle} onChange={(event) => void patch({ mapTitle: event.target.value })} /></Field>
              <Field label="Map subtitle"><TextInput value={state.mapSubtitle} onChange={(event) => void patch({ mapSubtitle: event.target.value })} /></Field>
              <Field label="Map focus"><TextInput value={state.mapFocus} onChange={(event) => void patch({ mapFocus: event.target.value })} /></Field>
              <Field label="Map callout"><TextArea value={state.mapCallout} onChange={(event) => void patch({ mapCallout: event.target.value })} /></Field>
            </div>
            <Field label="Rotation plan"><TextArea value={state.mapPlan.join("\n")} onChange={(event) => setLines("mapPlan", event.target.value)} /></Field>
          </div>
        </div>

        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Text panel and counter</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Text kicker"><TextInput value={state.textKicker} onChange={(event) => void patch({ textKicker: event.target.value })} /></Field>
              <Field label="Text title"><TextInput value={state.textTitle} onChange={(event) => void patch({ textTitle: event.target.value })} /></Field>
              <Field label="Text body"><TextArea value={state.textBody} onChange={(event) => void patch({ textBody: event.target.value })} /></Field>
              <Field label="Text footer"><TextInput value={state.textFooter} onChange={(event) => void patch({ textFooter: event.target.value })} /></Field>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Counter title"><TextInput value={state.counterTitle} onChange={(event) => void patch({ counterTitle: event.target.value })} /></Field>
                <Field label="Counter value"><TextInput value={state.counterValue} onChange={(event) => void patch({ counterValue: event.target.value })} /></Field>
              </div>
              <Field label="Counter label"><TextInput value={state.counterLabel} onChange={(event) => void patch({ counterLabel: event.target.value })} /></Field>
              <Field label="Counter items"><TextArea value={state.counterItems.join("\n")} onChange={(event) => setLines("counterItems", event.target.value)} /></Field>
            </div>
          </div>
        </div>

        <div className="card p-4 lg:col-span-2">
          <h2 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-cyan-200">Hero picks fullscreen</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <Field label="Picks title"><TextInput value={state.picksTitle} onChange={(event) => void patch({ picksTitle: event.target.value })} /></Field>
              <Field label="Picks subtitle"><TextInput value={state.picksSubtitle} onChange={(event) => void patch({ picksSubtitle: event.target.value })} /></Field>
              <Field label="Ally picks"><TextArea value={state.allyPicks.join("\n")} onChange={(event) => setLines("allyPicks", event.target.value)} /></Field>
            </div>
            <Field label="Enemy picks"><TextArea value={state.enemyPicks.join("\n")} onChange={(event) => setLines("enemyPicks", event.target.value)} /></Field>
          </div>
        </div>
      </div>
    </section>
  </main>;
}
