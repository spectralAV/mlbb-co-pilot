import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "../api/client";
import { HeroPicker } from "../components/HeroPicker";
import { useDraftStore, type DraftKind, type DraftSide, type DraftSlots, type Hero } from "../stores/draftStore";

type Target = { kind: DraftKind; side: DraftSide; slot: number };

function compactSlots(slots: DraftSlots) {
  return slots.filter((id): id is number => typeof id === "number");
}

function sameTarget(a: Target, b: Target) {
  return a.kind === b.kind && a.side === b.side && a.slot === b.slot;
}

function SlotGroup({ title, kind, side, ids, heroes, target, onTarget, onClear }: {
  title: string;
  kind: DraftKind;
  side: DraftSide;
  ids: DraftSlots;
  heroes: Hero[];
  target: Target;
  onTarget: (target: Target) => void;
  onClear: (target: Target) => void;
}) {
  return <div className="card p-3 sm:p-4">
    <h3 className="mb-3 font-bold">{title}</h3>
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => {
        const slotTarget = { kind, side, slot: index };
        const hero = heroes.find((item) => item.id === ids[index]);
        const active = sameTarget(target, slotTarget);
        return <div key={index} className={`flex min-h-16 items-center gap-2 rounded-lg border p-2 ${active ? "border-violet-400 bg-violet-500/20" : "border-white/10 bg-white/5"}`}>
          <button type="button" onClick={() => onTarget(slotTarget)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {hero?.icon ? <img src={hero.icon} className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm text-slate-400">{index + 1}</span>}
            <span className="min-w-0">
              <span className="block truncate text-sm">{hero?.name ?? `Slot ${index + 1}`}</span>
              <span className="block text-xs text-slate-400">{active ? "Selected target" : "Tap to target"}</span>
            </span>
          </button>
          {hero && <button type="button" onClick={() => onClear(slotTarget)} className="min-h-10 rounded-lg bg-white/10 px-3 text-xs text-slate-200 active:bg-white/20">Clear</button>}
        </div>;
      })}
    </div>
  </div>;
}

function nextOpenSlot(ids: DraftSlots, current: number) {
  const after = ids.findIndex((id, index) => index > current && id == null);
  if (after >= 0) return after;
  const any = ids.findIndex((id) => id == null);
  return any >= 0 ? any : current;
}

export function DraftRoom() {
  const heroesQ = useQuery({ queryKey: ["compiled-heroes"], queryFn: () => apiGet<{ success: boolean; data: Hero[] }>("/api/semantic/heroes") });
  const fallbackQ = useQuery({ queryKey: ["heroes"], queryFn: () => apiGet<{ success: boolean; data: Hero[] }>("/api/cache/heroes") });
  const heroes = (heroesQ.data?.data?.length ? heroesQ.data.data : fallbackQ.data?.data) ?? [];
  const draft = useDraftStore();
  const [target, setTarget] = useState<Target>({ kind: "pick", side: "ally", slot: 0 });
  const analyze = useMutation({
    mutationFn: () => apiPost<any>("/api/draft/analyze", {
      allyPicks: compactSlots(draft.allyPicks),
      enemyPicks: compactSlots(draft.enemyPicks),
      allyBans: compactSlots(draft.allyBans),
      enemyBans: compactSlots(draft.enemyBans),
      selectedLane: draft.selectedLane,
      selectedRole: draft.selectedRole,
      laneOrientation: draft.laneOrientation,
      phase: "pick"
    })
  });

  const selectedIds = [
    ...compactSlots(draft.allyPicks),
    ...compactSlots(draft.enemyPicks),
    ...compactSlots(draft.allyBans),
    ...compactSlots(draft.enemyBans)
  ];

  function slotsFor(nextTarget: Target) {
    if (nextTarget.kind === "ban") return nextTarget.side === "ally" ? draft.allyBans : draft.enemyBans;
    return nextTarget.side === "ally" ? draft.allyPicks : draft.enemyPicks;
  }

  function placeHero(heroId: number) {
    draft.placeHero(target.kind, target.side, target.slot, heroId);
    setTarget({ ...target, slot: nextOpenSlot(slotsFor(target), target.slot) });
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-3xl font-black">Draft Room</h2><p className="text-slate-400">Arrange allies, enemies, and bans by selecting a target slot before tapping a hero.</p></div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><button className="btn" onClick={() => analyze.mutate()}>Analyze Draft</button><button className="min-h-11 rounded-lg bg-white/10 px-4 py-2" onClick={draft.clear}>Clear</button></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SlotGroup title="Ally Bans" kind="ban" side="ally" ids={draft.allyBans} heroes={heroes} target={target} onTarget={setTarget} onClear={(slot) => draft.clearSlot(slot.kind, slot.side, slot.slot)} />
      <SlotGroup title="Ally Team" kind="pick" side="ally" ids={draft.allyPicks} heroes={heroes} target={target} onTarget={setTarget} onClear={(slot) => draft.clearSlot(slot.kind, slot.side, slot.slot)} />
      <SlotGroup title="Enemy Team" kind="pick" side="enemy" ids={draft.enemyPicks} heroes={heroes} target={target} onTarget={setTarget} onClear={(slot) => draft.clearSlot(slot.kind, slot.side, slot.slot)} />
      <SlotGroup title="Enemy Bans" kind="ban" side="enemy" ids={draft.enemyBans} heroes={heroes} target={target} onTarget={setTarget} onClear={(slot) => draft.clearSlot(slot.kind, slot.side, slot.slot)} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(280px,1fr)_minmax(280px,1.1fr)]">
      <HeroPicker heroes={heroes} selected={selectedIds} onToggle={placeHero} />
      <div className="card p-4">
        <h3 className="mb-3 font-bold">Strategy Brain</h3>
        {analyze.data ? <div className="space-y-3">
          <div><div className="text-sm text-slate-400">Recommendations</div>{analyze.data.data.recommendations?.map((result: any) => { const hero = heroes.find((item) => item.id === result.heroId); return <div key={result.heroId} className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3"><div className="flex justify-between gap-3"><span className="truncate">{hero?.name ?? result.heroId}</span><span className="text-violet-300">{result.score}</span></div><div className="mt-2 flex flex-wrap gap-1">{result.reasons?.map((reason: string) => <span className="chip" key={reason}>{reason}</span>)}</div></div>; })}</div>
          <div><div className="text-sm text-slate-400">Warnings</div>{analyze.data.data.warnings?.map((warning: any) => <div key={warning.id} className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3"><b>{warning.title}</b><p className="text-sm text-slate-300">{warning.message}</p></div>)}</div>
          <div><div className="text-sm text-slate-400">Ally Identity</div><div className="mt-2 flex flex-wrap gap-1">{analyze.data.data.allyIdentity?.map((item: string) => <span className="chip" key={item}>{item}</span>)}</div></div>
        </div> : <p className="text-slate-400">Pick heroes and run analysis.</p>}
      </div>
    </div>
  </div>;
}
