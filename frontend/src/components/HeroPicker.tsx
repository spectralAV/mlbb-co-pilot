import { useMemo, useState } from "react";
import type { Hero } from "../stores/draftStore";

export function HeroPicker({ heroes, selected, onToggle }: { heroes: Hero[]; selected: number[]; onToggle: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("All");
  const lanes = ["All", "Jungle", "Roam", "Gold Lane", "Mid Lane", "Exp Lane"];
  const filtered = useMemo(() => heroes.filter((hero) => (!query || hero.name.toLowerCase().includes(query.toLowerCase())) && (lane === "All" || hero.lanes?.includes(lane))).slice(0, 100), [heroes, query, lane]);

  return <div className="card p-3 sm:p-4">
    <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
      <input className="input w-full" placeholder="Search hero" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select className="input w-full sm:w-44" value={lane} onChange={(event) => setLane(event.target.value)}>{lanes.map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    <div className="touch-scroll grid max-h-[60vh] grid-cols-3 gap-2 overflow-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
      {filtered.map((hero) => <button key={hero.id} onClick={() => onToggle(hero.id)} className={`min-h-24 rounded-lg border p-2 text-left ${selected.includes(hero.id) ? "border-violet-400 bg-violet-500/20" : "border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15"}`}>
        {hero.icon && <img src={hero.icon} className="mx-auto h-12 w-12 rounded-full object-cover" />}
        <div className="mt-1 truncate text-center text-xs">{hero.name}</div>
      </button>)}
    </div>
  </div>;
}
