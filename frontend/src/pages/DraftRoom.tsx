import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "../api/client";
import { HeroPicker } from "../components/HeroPicker";
import { useDraftStore, type Hero } from "../stores/draftStore";

function PickSlots({ title, ids, heroes }: { title: string; ids: number[]; heroes: Hero[] }) {
  return <div className="card p-4">
    <h3 className="mb-3 font-bold">{title}</h3>
    <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => {
      const hero = heroes.find((item) => item.id === ids[index]);
      return <div className="flex min-h-14 items-center gap-3 rounded-lg bg-white/5 p-2" key={index}>
        {hero?.icon && <img src={hero.icon} className="h-10 w-10 rounded-full object-cover" />}
        <span className="truncate text-sm">{hero?.name ?? `Slot ${index + 1}`}</span>
      </div>;
    })}</div>
  </div>;
}

export function DraftRoom() {
  const heroesQ = useQuery({ queryKey: ["compiled-heroes"], queryFn: () => apiGet<{ success: boolean; data: Hero[] }>("/api/semantic/heroes") });
  const fallbackQ = useQuery({ queryKey: ["heroes"], queryFn: () => apiGet<{ success: boolean; data: Hero[] }>("/api/cache/heroes") });
  const heroes = (heroesQ.data?.data?.length ? heroesQ.data.data : fallbackQ.data?.data) ?? [];
  const draft = useDraftStore();
  const analyze = useMutation({ mutationFn: () => apiPost<any>("/api/draft/analyze", { allyPicks: draft.allyPicks, enemyPicks: draft.enemyPicks, allyBans: draft.allyBans, enemyBans: draft.enemyBans, selectedLane: draft.selectedLane, selectedRole: draft.selectedRole, laneOrientation: draft.laneOrientation, phase: "pick" }) });

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-3xl font-black">Draft Room</h2><p className="text-slate-400">Semantic draft analysis with team identity and warnings.</p></div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><button className="btn" onClick={() => analyze.mutate()}>Analyze Draft</button><button className="min-h-11 rounded-lg bg-white/10 px-4 py-2" onClick={draft.clear}>Clear</button></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(280px,1.2fr)_minmax(220px,1fr)]">
      <PickSlots title="Ally Team" ids={draft.allyPicks} heroes={heroes} />
      <div className="card p-4">
        <h3 className="mb-3 font-bold">Strategy Brain</h3>
        {analyze.data ? <div className="space-y-3">
          <div><div className="text-sm text-slate-400">Recommendations</div>{analyze.data.data.recommendations?.map((result: any) => { const hero = heroes.find((item) => item.id === result.heroId); return <div key={result.heroId} className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3"><div className="flex justify-between gap-3"><span className="truncate">{hero?.name ?? result.heroId}</span><span className="text-violet-300">{result.score}</span></div><div className="mt-2 flex flex-wrap gap-1">{result.reasons?.map((reason: string) => <span className="chip" key={reason}>{reason}</span>)}</div></div>; })}</div>
          <div><div className="text-sm text-slate-400">Warnings</div>{analyze.data.data.warnings?.map((warning: any) => <div key={warning.id} className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3"><b>{warning.title}</b><p className="text-sm text-slate-300">{warning.message}</p></div>)}</div>
          <div><div className="text-sm text-slate-400">Ally Identity</div><div className="mt-2 flex flex-wrap gap-1">{analyze.data.data.allyIdentity?.map((item: string) => <span className="chip" key={item}>{item}</span>)}</div></div>
        </div> : <p className="text-slate-400">Pick heroes and run analysis.</p>}
      </div>
      <PickSlots title="Enemy Team" ids={draft.enemyPicks} heroes={heroes} />
    </div>
    <HeroPicker heroes={heroes} selected={[...draft.allyPicks, ...draft.enemyPicks]} onToggle={(id) => draft.allyPicks.length < 5 ? draft.togglePick("ally", id) : draft.togglePick("enemy", id)} />
  </div>;
}
