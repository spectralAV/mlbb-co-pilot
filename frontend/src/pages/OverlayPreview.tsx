import { type ReactNode, useEffect, useState } from "react";
import { Eye, EyeOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { getCoachState } from "../api/client";
import { EditableGrid, type EditableGridItem } from "../components/EditableGrid";

type OverlaySection = "bans" | "map" | "picks" | "best" | "insights" | "build" | "tips" | "alert";

type OverlaySettings = {
  scale: number;
  safe: number;
  visible: Record<OverlaySection, boolean>;
};

const roles = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];
const overlayStorageKey = "mlbb.overlay.settings.v2";
const overlayGridStorageKey = "mlbb.overlay.gridLayout.v2";
const defaultOverlaySettings: OverlaySettings = {
  scale: 1,
  safe: 16,
  visible: {
    bans: true,
    map: true,
    picks: true,
    best: true,
    insights: true,
    build: true,
    tips: true,
    alert: true
  }
};

function loadOverlaySettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(overlayStorageKey) ?? "{}");
    return {
      ...defaultOverlaySettings,
      ...parsed,
      visible: { ...defaultOverlaySettings.visible, ...(parsed.visible ?? {}) }
    } as OverlaySettings;
  } catch {
    return defaultOverlaySettings;
  }
}

function initials(name?: string) {
  if (!name || name === "-") return "?";
  return name.split(/[\s-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function OverlayCard({ title, tone = "", children }: { title: string; tone?: string; children: ReactNode }) {
  return <div className="card flex h-full min-h-0 flex-col overflow-hidden p-3">
    <h2 className={`mb-2 shrink-0 text-[clamp(11px,1vw,16px)] font-black uppercase leading-tight ${tone}`}>{title}</h2>
    <div className="min-h-0 flex-1 overflow-hidden text-[clamp(10px,.82vw,14px)] leading-snug">{children}</div>
  </div>;
}

function Slots({ picks, enemy = false }: { picks: string[]; enemy?: boolean }) {
  return <div className="grid grid-cols-5 gap-2">
    {roles.map((role, index) => {
      const hero = picks[index] ?? "-";
      return <div key={`${role}-${hero}`} className={`min-h-0 rounded-lg border ${enemy ? "border-red-400/60 bg-red-500/10" : "border-sky-400/60 bg-sky-500/10"} flex flex-col items-center justify-center overflow-hidden p-1`}>
        <div className="grid aspect-square w-[clamp(28px,3vw,48px)] place-items-center rounded-md border border-white/20 bg-white/10 text-[clamp(14px,1.8vw,22px)] font-black">{initials(hero)}</div>
        <div className="mt-1 text-[9px] font-bold text-slate-300">{role}</div>
        <div className="max-w-full truncate px-1 text-[10px] text-slate-100">{hero}</div>
      </div>;
    })}
  </div>;
}

function TokenList({ title, items, red = false }: { title: string; items: string[]; red?: boolean }) {
  return <div>
    <div className={`mb-2 text-sm font-black ${red ? "text-red-300" : "text-sky-300"}`}>{title}</div>
    <div className="flex flex-wrap gap-2">{(items.length ? items : ["-"]).map((item) => <span key={item} className="rounded-md border border-white/10 bg-white/10 px-2 py-1 text-xs">{item}</span>)}</div>
  </div>;
}

export function OverlayPreview() {
  const [data, setData] = useState<any>(null);
  const [settings, setSettings] = useState<OverlaySettings>(loadOverlaySettings);
  const [gridResetNonce, setGridResetNonce] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await getCoachState();
        if (active) setData(next);
      } catch {
        if (active) setData(null);
      }
    }
    void load();
    const timer = window.setInterval(load, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    localStorage.setItem(overlayStorageKey, JSON.stringify(settings));
  }, [settings]);

  const rec = data?.recommendation ?? {};
  const map = data?.map_state ?? {};
  const top = rec.top_picks ?? [];
  const best = top[0];
  const visible = settings.visible;
  const showEditor = window.location.pathname !== "/overlay";

  function setVisible(section: OverlaySection) {
    setSettings((current) => ({ ...current, visible: { ...current.visible, [section]: !current.visible[section] } }));
  }

  function resetOverlay() {
    setSettings(defaultOverlaySettings);
    setGridResetNonce((current) => current + 1);
  }

  const overlayItems: EditableGridItem[] = [
    {
      id: "bans",
      title: "Bans",
      x: 0,
      y: 0,
      w: 3,
      h: 3,
      minW: 2,
      minH: 2,
      content: <OverlayCard title="Bans"><TokenList title="Ally Bans" items={rec.ally_bans ?? []} /><div className="mt-3"><TokenList title="Enemy Bans" items={rec.enemy_bans ?? []} red /></div></OverlayCard>
    },
    {
      id: "map",
      title: "Map Awareness",
      x: 0,
      y: 3,
      w: 3,
      h: 4,
      minW: 2,
      minH: 2,
      content: <OverlayCard title="Map Awareness"><div className="flex justify-between"><span>Visible Enemies</span><b>{map.visible_enemies?.length ?? 0}</b></div><div className="mt-2 flex justify-between"><span>Missing</span><b className="text-red-300">{map.missing_enemy_count ?? 5}</b></div><div className="mt-3 space-y-1.5 text-slate-200">{(map.callouts ?? ["Start realtime capture for map callouts."]).slice(0, 3).map((line: string) => <div key={line} className="line-clamp-2">* {line}</div>)}</div></OverlayCard>
    },
    {
      id: "picks",
      title: "Team Picks",
      x: 3,
      y: 0,
      w: 6,
      h: 3,
      minW: 4,
      minH: 2,
      content: <OverlayCard title="Team Picks"><div className="grid h-full grid-cols-[1fr_36px_1fr] items-center gap-2"><Slots picks={rec.ally_picks ?? []} /><div className="text-center font-black text-slate-400">VS</div><Slots picks={rec.enemy_picks ?? []} enemy /></div></OverlayCard>
    },
    {
      id: "best",
      title: "Best Picks",
      x: 3,
      y: 3,
      w: 6,
      h: 4,
      minW: 4,
      minH: 3,
      content: <OverlayCard title="Best Picks For Your Role" tone="text-emerald-300"><div className="grid h-full grid-cols-3 gap-2">{(top.length ? top.slice(0, 3) : [{ hero: "Waiting", score: 0, reasons: ["Sync data or send draft state."] }]).map((pick: any, index: number) => <div key={`${pick.hero}-${index}`} className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/5 p-2"><div className="flex justify-between gap-2 font-black"><span className="truncate">{index + 1}. {pick.hero}</span><span className="shrink-0 text-emerald-300">{pick.score ?? 0}%</span></div><div className="mt-2 flex gap-2"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-500/20 text-lg font-black">{initials(pick.hero)}</div><div className="min-w-0 text-slate-200">{(pick.reasons ?? ["Stable role pick"]).slice(0, 2).map((reason: string) => <p key={reason} className="line-clamp-2">{reason}</p>)}</div></div></div>)}</div></OverlayCard>
    },
    {
      id: "insights",
      title: "Insights",
      x: 3,
      y: 7,
      w: 6,
      h: 3,
      minW: 4,
      minH: 3,
      content: <OverlayCard title="Counter + Teamfight Insights" tone="text-violet-300"><div className="grid h-full gap-2 md:grid-cols-2"><div className="overflow-hidden rounded-lg bg-black/20 p-2"><h3 className="font-black text-violet-200">Risk</h3><p className="mt-1 line-clamp-3 text-red-300">{rec.threats?.[0] ?? "Waiting for enemy picks/map."}</p></div><div className="overflow-hidden rounded-lg bg-black/20 p-2"><h3 className="font-black text-violet-200">Suggested Calls</h3><ul className="mt-1 list-disc pl-4">{(map.suggestions ?? []).slice(0, 3).map((line: string) => <li key={line} className="line-clamp-1">{line}</li>)}</ul></div></div></OverlayCard>
    },
    {
      id: "build",
      title: "Build Suggestion",
      x: 9,
      y: 0,
      w: 3,
      h: 3,
      minW: 2,
      minH: 2,
      content: <OverlayCard title="Build Suggestion"><div className="uppercase text-slate-400">For your core: <b className="text-white">{best?.hero ?? "-"}</b></div><div className="mt-3 grid grid-cols-6 gap-1">{["Boots", "Core", "Pen", "Def", "Flex", "Imm"].map((item, index) => <div key={item} className="text-center"><div className="mx-auto grid aspect-square w-[clamp(24px,2.4vw,38px)] place-items-center rounded-full border border-white/20 bg-emerald-500/20">{index + 1}</div><div className="mt-1 truncate text-[9px] text-slate-300">{item}</div></div>)}</div></OverlayCard>
    },
    {
      id: "tips",
      title: "Live Tips",
      x: 9,
      y: 3,
      w: 3,
      h: 3,
      minW: 2,
      minH: 2,
      content: <OverlayCard title="Live Tips"><ul className="list-disc space-y-1 pl-5 text-slate-200">{(rec.notes ?? ["Track missing enemies before Turtle/Lord."]).slice(0, 4).map((tip: string) => <li key={tip} className="line-clamp-2">{tip}</li>)}</ul></OverlayCard>
    },
    {
      id: "alert",
      title: "Team Callout Alert",
      x: 9,
      y: 6,
      w: 3,
      h: 4,
      minW: 2,
      minH: 3,
      content: <OverlayCard title="Team Callout Alert" tone="text-red-300"><p className="text-[clamp(14px,1.4vw,20px)] font-black text-red-300">{(map.missing_enemy_count ?? 5) >= 3 ? "Possible Gank / Collapse" : "Map Stable"}</p><p className="mt-2 line-clamp-4 text-slate-200">{map.callouts?.[0] ?? "Waiting for minimap reader."}</p></OverlayCard>
    }
  ].filter((item) => visible[item.id as OverlaySection]);

  return <main className="min-h-screen bg-[#050916] p-2 text-white sm:p-4">
    {showEditor && <div className="mx-auto mb-3 flex max-w-[1600px] flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-slate-900/80 p-3">
      <div className="flex min-w-48 items-center gap-2 text-sm font-bold text-slate-200"><SlidersHorizontal className="h-4 w-4 text-cyan-300" />Overlay editor</div>
      <label className="flex min-h-10 items-center gap-2 rounded-lg bg-white/5 px-3 text-sm">Scale <input type="range" min="0.72" max="1" step="0.02" value={settings.scale} onChange={(event) => setSettings((current) => ({ ...current, scale: Number(event.target.value) }))} /></label>
      <label className="flex min-h-10 items-center gap-2 rounded-lg bg-white/5 px-3 text-sm">Safe <input type="range" min="6" max="32" step="2" value={settings.safe} onChange={(event) => setSettings((current) => ({ ...current, safe: Number(event.target.value) }))} /></label>
      <div className="flex flex-wrap gap-1">{(Object.keys(visible) as OverlaySection[]).map((section) => <button key={section} className={`min-h-10 rounded-lg px-3 text-xs font-bold uppercase ${visible[section] ? "bg-cyan-500/20 text-cyan-100" : "bg-white/5 text-slate-400"}`} onClick={() => setVisible(section)}>{visible[section] ? <Eye className="mr-1 inline h-3 w-3" /> : <EyeOff className="mr-1 inline h-3 w-3" />}{section}</button>)}</div>
      <button className="ml-auto min-h-10 rounded-lg bg-white/10 px-3 text-sm text-slate-200 active:bg-white/20" onClick={resetOverlay}><RotateCcw className="mr-2 inline h-4 w-4" />Reset</button>
    </div>}

    <div className="mx-auto aspect-[20/9] w-full max-w-[1600px] overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(circle_at_55%_0%,rgba(51,116,255,.18),transparent_32%),linear-gradient(160deg,rgba(2,6,15,.98),rgba(7,13,31,.94))] shadow-2xl" style={{ padding: settings.safe }}>
      <div className="h-full origin-top-left" style={{ transform: `scale(${settings.scale})`, width: `${100 / settings.scale}%`, height: `${100 / settings.scale}%` }}>
        <header className="mb-2 grid grid-cols-[1fr_auto_auto] items-center gap-3">
          <div><h1 className="text-4xl font-black italic tracking-normal"><span className="text-white">MLBB</span> <span className="text-sky-400">COACH</span></h1><p className="text-sm font-bold uppercase text-slate-300">Draft / Bans / Map Awareness / Builds</p></div>
          <div className="inline-flex min-h-11 items-center justify-center rounded-lg border border-violet-300/30 bg-violet-500/20 px-4 py-2 text-lg font-black uppercase">Ranked</div>
          <div className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-300/20 bg-black/30 px-4 py-2 text-sm font-black text-emerald-300">{data?.obs_realtime_enabled ? "LIVE" : "MANUAL"} / OBS PREPARED</div>
        </header>

        <EditableGrid
          storageKey={overlayGridStorageKey}
          items={overlayItems}
          rowHeight={48}
          gap={12}
          editable={showEditor}
          toolbar={false}
          resetNonce={gridResetNonce}
          className="h-[calc(100%-82px)] overflow-hidden"
        />
      </div>
    </div>
  </main>;
}
