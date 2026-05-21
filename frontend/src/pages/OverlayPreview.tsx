import { useEffect, useState } from "react";
import { getCoachState } from "../api/client";

function initials(name?: string) {
  if (!name || name === "-") return "?";
  return name.split(/[\s-]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

const roles = ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"];

function Slots({ picks, enemy = false }: { picks: string[]; enemy?: boolean }) {
  return <div className="grid grid-cols-5 gap-1 sm:gap-2">
    {roles.map((role, index) => {
      const hero = picks[index] ?? "-";
      return <div key={`${role}-${hero}`} className={`min-h-20 rounded-lg border ${enemy ? "border-red-400/60 bg-red-500/10" : "border-sky-400/60 bg-sky-500/10"} flex flex-col items-center justify-center overflow-hidden p-1 sm:min-h-28`}>
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/20 bg-white/10 text-base font-black sm:h-14 sm:w-14 sm:text-xl">{initials(hero)}</div>
        <div className="mt-1 text-[10px] font-bold text-slate-300 sm:mt-2 sm:text-[11px]">{role}</div>
        <div className="max-w-full truncate px-2 text-xs text-slate-100">{hero}</div>
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

  const rec = data?.recommendation ?? {};
  const map = data?.map_state ?? {};
  const top = rec.top_picks ?? [];
  const best = top[0];

  return <main className="min-h-screen bg-[#050916] p-2 text-white sm:p-4">
    <div className="mx-auto w-full max-w-[1600px] overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(circle_at_55%_0%,rgba(51,116,255,.18),transparent_32%),linear-gradient(160deg,rgba(2,6,15,.98),rgba(7,13,31,.94))] p-3 shadow-2xl sm:p-4 xl:aspect-[20/9] xl:max-h-[calc(100vh-32px)]">
      <header className="mb-3 grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto] xl:grid-cols-[1fr_auto_auto]">
        <div><h1 className="text-3xl font-black italic tracking-normal sm:text-4xl"><span className="text-white">MLBB</span> <span className="text-sky-400">COACH</span></h1><p className="text-xs font-bold uppercase text-slate-300 sm:text-sm">Draft / Bans / Map Awareness / Builds</p></div>
        <div className="inline-flex min-h-11 items-center justify-center rounded-lg border border-violet-300/30 bg-violet-500/20 px-4 py-2 text-sm font-black uppercase sm:text-lg">Ranked</div>
        <div className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-300/20 bg-black/30 px-4 py-2 text-xs font-black text-emerald-300 sm:text-sm">{data?.obs_realtime_enabled ? "LIVE" : "MANUAL"} / OBS PREPARED</div>
      </header>

      <section className="grid gap-3 xl:h-[calc(100%-92px)] xl:grid-cols-[minmax(230px,365px)_minmax(420px,1fr)_minmax(260px,420px)]">
        <aside className="grid min-h-0 gap-3 md:grid-cols-3 xl:flex xl:flex-col">
          <div className="card p-3 sm:p-4"><h2 className="mb-3 font-black uppercase">Bans</h2><TokenList title="Ally Bans" items={rec.ally_bans ?? []} /><div className="mt-4"><TokenList title="Enemy Bans" items={rec.enemy_bans ?? []} red /></div></div>
          <div className="card p-3 sm:p-4"><h2 className="mb-3 font-black uppercase">Map Awareness</h2><div className="flex justify-between"><span>Visible Enemies</span><b>{map.visible_enemies?.length ?? 0}</b></div><div className="mt-2 flex justify-between"><span>Missing</span><b className="text-red-300">{map.missing_enemy_count ?? 5}</b></div><div className="mt-3 space-y-2 text-sm text-slate-200">{(map.callouts ?? ["Start OBS realtime for map callouts."]).slice(0, 3).map((line: string) => <div key={line}>• {line}</div>)}</div></div>
          <div className="card min-h-0 p-3 sm:p-4 xl:flex-1"><h2 className="mb-3 font-black uppercase">Minimap</h2><div className="relative h-44 overflow-hidden rounded-lg border border-sky-300/30 bg-[linear-gradient(135deg,rgba(40,184,255,.15)_0_35%,transparent_35%_100%),linear-gradient(315deg,rgba(255,71,96,.15)_0_35%,transparent_35%_100%),rgba(8,17,35,.95)] xl:h-52"><div className="absolute left-16 top-14 h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_12px_#38bdf8]" /><div className="absolute right-16 top-14 h-3 w-3 rounded-full bg-red-400 shadow-[0_0_12px_#f87171]" /><div className="absolute left-44 top-28 h-3 w-3 rounded-full bg-violet-400 shadow-[0_0_12px_#c084fc]" /></div></div>
        </aside>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="card p-3 sm:p-4"><h2 className="mb-3 font-black uppercase">Team Picks</h2><div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_44px_1fr]"><Slots picks={rec.ally_picks ?? []} /><div className="text-center font-black text-slate-400">VS</div><Slots picks={rec.enemy_picks ?? []} enemy /></div></div>
          <div className="card p-3 sm:p-4"><h2 className="mb-3 font-black uppercase text-emerald-300">Best Picks For Your Role</h2><div className="grid gap-3 md:grid-cols-3">{(top.length ? top.slice(0, 3) : [{ hero: "Waiting", score: 0, reasons: ["Sync data or send draft state."] }]).map((pick: any, index: number) => <div key={`${pick.hero}-${index}`} className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="flex justify-between text-base font-black sm:text-lg"><span>{index + 1}. {pick.hero}</span><span className="text-emerald-300">{pick.score ?? 0}%</span></div><div className="mt-3 flex gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-sky-500/20 text-xl font-black sm:h-16 sm:w-16 sm:text-2xl">{initials(pick.hero)}</div><div className="text-sm text-slate-200">{(pick.reasons ?? ["Stable role pick"]).slice(0, 2).map((r: string) => <p key={r}>{r}</p>)}</div></div></div>)}</div></div>
          <div className="card min-h-0 flex-1 p-3 sm:p-4"><h2 className="mb-3 font-black uppercase text-violet-300">Counter + Teamfight Insights</h2><div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-black/20 p-3 sm:p-4"><h3 className="font-black text-violet-200">Risk</h3><p className="mt-2 text-red-300">{rec.threats?.[0] ?? "Waiting for enemy picks/map."}</p></div><div className="rounded-lg bg-black/20 p-3 sm:p-4"><h3 className="font-black text-violet-200">Suggested Calls</h3><ul className="mt-2 list-disc pl-5 text-sm">{(map.suggestions ?? []).slice(0, 4).map((line: string) => <li key={line}>{line}</li>)}</ul></div></div></div>
        </section>

        <aside className="grid min-h-0 gap-3 md:grid-cols-3 xl:flex xl:flex-col">
          <div className="card p-3 sm:p-4"><h2 className="mb-3 font-black uppercase">Build Suggestion</h2><div className="text-sm uppercase text-slate-400">For your core: <b className="text-white">{best?.hero ?? "-"}</b></div><div className="mt-5 grid grid-cols-6 gap-2">{["Boots", "Core", "Pen", "Defense", "Flex", "Immortality"].map((item, i) => <div key={item} className="text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-emerald-500/20 sm:h-12 sm:w-12">{i + 1}</div><div className="mt-1 text-[10px] text-slate-300">{item}</div></div>)}</div></div>
          <div className="card p-3 sm:p-4"><h2 className="mb-3 font-black uppercase">Live Tips</h2><ul className="list-disc pl-5 text-sm text-slate-200">{(rec.notes ?? ["Track missing enemies before Turtle/Lord."]).slice(0, 5).map((tip: string) => <li key={tip}>{tip}</li>)}</ul></div>
          <div className="card border-red-400/20 p-3 sm:p-4 xl:flex-1"><h2 className="mb-3 font-black uppercase text-red-300">Team Callout Alert</h2><p className="text-lg font-black text-red-300">{(map.missing_enemy_count ?? 5) >= 3 ? "Possible Gank / Collapse" : "Map Stable"}</p><p className="mt-2 text-sm text-slate-200">{map.callouts?.[0] ?? "Waiting for minimap reader."}</p></div>
        </aside>
      </section>
    </div>
  </main>;
}
