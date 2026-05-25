import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Sparkles, X } from "lucide-react";
import { apiGet, apiPost } from "../api/client";
import type { Hero } from "../stores/draftStore";

type SynergySuggestion = {
  heroId: number;
  heroName: string;
  imgSrc?: string;
  role: string[];
  lane: string[];
  speciality: string[];
  score: number;
  reasons: string[];
  synergyHeroes: Array<{ id: number; name: string }>;
};

const lanes = ["All", "Gold Lane", "Exp Lane", "Mid Lane", "Roam", "Jungle"];
const roles = ["All", "Tank", "Fighter", "Assassin", "Mage", "Marksman", "Support"];

export function HeroSynergy() {
  const heroesQ = useQuery({ queryKey: ["compiled-heroes"], queryFn: () => apiGet<{ success: boolean; data: Hero[] }>("/api/semantic/heroes") });
  const fallbackQ = useQuery({ queryKey: ["heroes"], queryFn: () => apiGet<{ success: boolean; data: Hero[] }>("/api/cache/heroes") });
  const heroes = (heroesQ.data?.data?.length ? heroesQ.data.data : fallbackQ.data?.data) ?? [];
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("All");
  const [role, setRole] = useState("All");

  const suggestions = useMutation({
    mutationFn: () => apiPost<{ success: boolean; data: SynergySuggestion[] }>("/api/draft/synergy", {
      allyHeroes: selected,
      lane: lane === "All" ? undefined : lane,
      role: role === "All" ? undefined : role
    })
  });

  const selectedHeroes = selected.map((id) => heroes.find((hero) => hero.id === id)).filter((hero): hero is Hero => Boolean(hero));
  const filteredHeroes = useMemo(() => heroes
    .filter((hero) => !selected.includes(hero.id))
    .filter((hero) => !query || hero.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 120), [heroes, query, selected]);
  const visibleSuggestions = (suggestions.data?.data ?? []).filter((item) => {
    const laneOk = lane === "All" || item.lane.includes(lane);
    const roleOk = role === "All" || item.role.includes(role);
    return laneOk && roleOk;
  });

  function addHero(heroId: number) {
    if (selected.length >= 4 || selected.includes(heroId)) return;
    setSelected((current) => [...current, heroId]);
    setQuery("");
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Hero Synergy</h2>
        <p className="text-slate-400">Build an ally core and ask the draft brain for complementary picks.</p>
      </div>
      <div className="flex gap-2">
        <button className="min-h-11 rounded-lg bg-white/10 px-4 py-2 font-semibold text-slate-200" onClick={() => { setSelected([]); suggestions.reset(); }}>Clear All</button>
        <button className="btn flex items-center gap-2" disabled={!selected.length || suggestions.isPending} onClick={() => suggestions.mutate()}>
          <Sparkles size={18} /> {suggestions.isPending ? "Scoring..." : "Get Suggestions"}
        </button>
      </div>
    </div>

    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold">Ally Heroes</h3>
        <span className="text-sm text-slate-400">{selected.length}/4 selected</span>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:flex">
        {Array.from({ length: 4 }).map((_, index) => {
          const hero = selectedHeroes[index];
          return <div key={index} className="relative min-h-24 rounded-lg border border-white/10 bg-white/5 p-2 text-center sm:w-24">
            {hero ? <>
              {hero.icon && <img src={hero.icon} className="mx-auto h-14 w-14 rounded-lg object-cover" />}
              <div className="mt-1 truncate text-xs">{hero.name}</div>
              <button className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-slate-100" onClick={() => setSelected((current) => current.filter((id) => id !== hero.id))}><X size={14} /></button>
            </> : <div className="flex h-full min-h-20 items-center justify-center text-xs text-slate-500">Slot {index + 1}</div>}
          </div>;
        })}
      </div>
    </section>

    <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.1fr)]">
      <section className="card p-4">
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="input w-full pl-9" placeholder="Search hero" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <select className="input" value={lane} onChange={(event) => setLane(event.target.value)}>{lanes.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="touch-scroll grid max-h-[58vh] grid-cols-3 gap-2 overflow-auto pr-1 sm:grid-cols-4">
          {filteredHeroes.map((hero) => <button key={hero.id} disabled={selected.length >= 4} onClick={() => addHero(hero.id)} className="min-h-24 rounded-lg border border-white/10 bg-white/5 p-2 text-left hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45">
            {hero.icon && <img src={hero.icon} className="mx-auto h-12 w-12 rounded-full object-cover" />}
            <div className="mt-1 truncate text-center text-xs">{hero.name}</div>
          </button>)}
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-bold">Suggested Heroes</h3>
          <div className="flex gap-2">
            <select className="input min-h-10" value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select>
            <select className="input min-h-10" value={lane} onChange={(event) => setLane(event.target.value)}>{lanes.map((item) => <option key={item}>{item}</option>)}</select>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {visibleSuggestions.length ? visibleSuggestions.slice(0, 8).map((item) => <article key={item.heroId} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex gap-3">
              {item.imgSrc && <img src={item.imgSrc} className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="truncate font-bold">{item.heroName}</h4>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-black text-emerald-200">{item.score}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">{[...item.role, ...item.lane].slice(0, 4).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-300">{item.reasons.slice(0, 3).map((reason) => <p key={reason}>{reason}</p>)}</div>
            <div className="mt-2 text-[11px] text-slate-500">With {item.synergyHeroes.map((hero) => hero.name).join(", ") || "current ally core"}</div>
          </article>) : <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-slate-400 md:col-span-2">
            {selected.length ? "Run suggestions to score the current ally core." : "Select at least one ally hero."}
          </div>}
        </div>
      </section>
    </div>
  </div>;
}

export default HeroSynergy;
