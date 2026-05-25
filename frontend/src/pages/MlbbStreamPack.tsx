import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, Hash, MessageSquareText, Radio, RotateCcw, Shield, Swords, Timer, Trophy } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { apiGet, getMatchState, getOverlayState, updateOverlayState } from "../api/client";
import { BattlefieldMap, type TacticalMapMarker } from "../components/game/BattlefieldMap";
import { type MapZoneState, defaultMapZones } from "../lib/gameTypes";
import { resolveHeroIcon } from "../utils/assetResolver";

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
  updatedAt: string;
};

type HeroVisual = {
  name: string;
  icon?: string;
  roles: string[];
  lanes: string[];
  specialties: string[];
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
  picksSubtitle: "Awaiting confirmed portraits",
  allyPicks: [],
  enemyPicks: [],
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
    enemyPicks: Array.isArray(next.enemyPicks) ? next.enemyPicks : defaultState.enemyPicks
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
  const detectedAt = Number(current?.draft?.detectedAt ?? 0);
  const fresh = Number.isFinite(detectedAt) && Date.now() - detectedAt < 8000;
  return current?.confidence?.draftTrusted && current?.lifecycle?.screen === "draft" && fresh ? current.draft : null;
}

function getDisplayState(state: LocalOverlayState, matchState: any): LocalOverlayState {
  const current = currentMatch(matchState);
  const live = currentReasoning(current);
  const draft = currentDraft(current);
  const topPick = draft?.analysis?.bestPick;
  const ally = (draft?.allyPicks?.length ? draft.allyPicks : draft?.allyBans ?? []).map((slot: any) => slot.heroName).filter(Boolean);
  const enemy = (draft?.enemyPicks?.length ? draft.enemyPicks : draft?.enemyBans ?? []).map((slot: any) => slot.heroName).filter(Boolean);
  const missingCount = Number(live?.observation?.missingEnemyCount);
  const plan = live ? [live.recommendedAction, live.reason].filter((line, index, list) => line && list.indexOf(line) === index) : [];
  const activeScene: Scene = draft ? "draft" : live?.scene === "text" || live?.scene === "counter" ? "alert" : "hidden";
  return {
    ...state,
    mode: current?.lifecycle?.screen ?? "waiting",
    activeScene,
    bestPick: topPick?.hero || "Awaiting detected picks",
    confidence: Number(topPick?.score ?? 0),
    reason: topPick?.reasons?.[0] || "Waiting for confirmed draft portrait matches.",
    warning: live?.callout || "",
    matchPhase: draft ? `Detected ${draft.phase}` : current?.lifecycle?.screen ? `Detected ${current.lifecycle.screen}` : "Awaiting detection",
    timer: "--:--",
    objective: String(live?.observation?.objectiveName ?? "Objective"),
    objectiveTimer: Number.isFinite(Number(live?.observation?.objectiveSpawnsInSec)) ? `${live.observation.objectiveSpawnsInSec}s` : "--:--",
    lowerTitle: "Detected state",
    lowerSubtitle: live?.callout || (draft ? "Confirmed draft portraits" : "Waiting for reliable frame"),
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
    picksSubtitle: draft ? `${Math.round(Number(draft.confidence) * 100)}% portrait confidence` : "Awaiting confirmed portraits",
    allyPicks: ally,
    enemyPicks: enemy,
  };
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
  const markers: TacticalMapMarker[] = match?.confidence?.visionTrusted
    ? (match.vision?.minimapMarkers ?? []).filter((marker: TacticalMapMarker) => Number(marker.confidence ?? 0) >= Number(match.confidence.minimum ?? 0.55))
    : [];

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
            <MapStat label="Visible pins" value={String(markers.length)} tone="text-cyan-200" />
            <MapStat label="Objective" value={display.objectiveTimer} tone="text-amber-200" />
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
  const picks = detected;
  return [...picks, "-", "-", "-", "-", "-"].slice(0, 5);
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
    <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5 p-6">
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
          <p className="text-base font-bold leading-snug text-slate-300">{display.reason}</p>
        </div>
        <div className="space-y-2.5">
          <div className="text-right text-sm font-black uppercase tracking-[0.24em] text-red-200">{display.teamRed}</div>
          {enemy.map((hero, index) => <div key={`enemy-${hero}-${index}`}><HeroPickCard hero={hero} index={index} side="enemy" accent={display.accent} meta={heroCatalog.get(heroKey(hero))} /></div>)}
        </div>
      </section>
    </div>
  </OutputShell>;
}

type LiveOutputScene = "main" | "map" | "text" | "counter" | "picks";

function selectLiveOutputScene(matchState: any): LiveOutputScene {
  const match = currentMatch(matchState);
  if (!match) return "main";
  if (currentDraft(match)) return "picks";
  const decision = currentReasoning(match);
  if (decision?.ruleId === "draft_state") return "main";
  if (decision && ["main", "map", "text", "counter", "picks"].includes(decision.scene)) return decision.scene as LiveOutputScene;
  return "main";
}

export function MlbbLiveOutput() {
  const { matchState } = useOverlayState();
  const scene = selectLiveOutputScene(matchState);

  if (scene === "picks") return <MlbbHeroPicksOutput />;
  if (scene === "counter") return <MlbbCounterOutput />;
  if (scene === "map") return <MlbbTacticalMapOutput />;
  if (scene === "text") return <MlbbTextPanelOutput />;
  return <MlbbStreamOutput />;
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

export function MlbbStreamControl() {
  const { state, matchState, patch, saving } = useOverlayState();
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
          <MapStat label="Draft portrait confidence" value={display.picksSubtitle} tone="text-cyan-200" />
          <MapStat label="Callout" value={display.textTitle} tone="text-amber-200" />
          <MapStat label="Output scene" value={selectLiveOutputScene(matchState)} tone="text-emerald-200" />
        </div>
        <div className="mt-5 border border-white/10 bg-black/25 p-4">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Confirmed draft heroes</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...display.allyPicks, ...display.enemyPicks].length
              ? [...display.allyPicks, ...display.enemyPicks].map((hero) => <span key={hero} className="border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-sm font-bold">{hero}</span>)
              : <span className="text-sm text-slate-400">No portrait has crossed the detection gate.</span>}
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
          <p className="mt-3 text-xs text-slate-400">{saving ? "Saving presentation." : "Color only; detection owns all output content."}</p>
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
