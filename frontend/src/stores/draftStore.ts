import { create } from "zustand";

export type Hero = { id: number; name: string; roles: string[]; lanes: string[]; specialties: string[]; icon?: string; semantic_tags?: string[]; weaknesses?: string[]; strengths?: string[] };
export type DraftSide = "ally" | "enemy";
export type DraftKind = "pick" | "ban";
export type DraftSlots = Array<number | null>;

type DraftStore = {
  allyPicks: DraftSlots;
  enemyPicks: DraftSlots;
  allyBans: DraftSlots;
  enemyBans: DraftSlots;
  selectedLane?: string;
  selectedRole?: string;
  laneOrientation: "blue_gold_top" | "blue_gold_bottom";
  setLane: (lane?: string) => void;
  togglePick: (side: DraftSide, heroId: number) => void;
  placeHero: (kind: DraftKind, side: DraftSide, slot: number, heroId: number) => void;
  clearSlot: (kind: DraftKind, side: DraftSide, slot: number) => void;
  clear: () => void;
};

const emptySlots = (): DraftSlots => Array.from({ length: 5 }, () => null);

function keyOf(kind: DraftKind, side: DraftSide): "allyPicks" | "enemyPicks" | "allyBans" | "enemyBans" {
  if (kind === "ban") return side === "ally" ? "allyBans" : "enemyBans";
  return side === "ally" ? "allyPicks" : "enemyPicks";
}

function removeHero(slots: DraftSlots, heroId: number) {
  return slots.map((id) => id === heroId ? null : id);
}

function setSlot(slots: DraftSlots, slot: number, heroId: number | null) {
  const next = [...slots];
  while (next.length < 5) next.push(null);
  next[Math.max(0, Math.min(4, slot))] = heroId;
  return next.slice(0, 5);
}

export const useDraftStore = create<DraftStore>((set) => ({
  allyPicks: emptySlots(),
  enemyPicks: emptySlots(),
  allyBans: emptySlots(),
  enemyBans: emptySlots(),
  laneOrientation: "blue_gold_bottom",
  setLane: (lane) => set({ selectedLane: lane }),
  togglePick: (side, heroId) => set((state) => {
    const key = keyOf("pick", side);
    const slots = state[key];
    const existing = slots.indexOf(heroId);
    if (existing >= 0) return { [key]: setSlot(slots, existing, null) };
    const firstOpen = slots.findIndex((id) => id == null);
    if (firstOpen < 0) return {};
    return {
      allyPicks: removeHero(state.allyPicks, heroId),
      enemyPicks: removeHero(state.enemyPicks, heroId),
      allyBans: removeHero(state.allyBans, heroId),
      enemyBans: removeHero(state.enemyBans, heroId),
      [key]: setSlot(removeHero(slots, heroId), firstOpen, heroId)
    };
  }),
  placeHero: (kind, side, slot, heroId) => set((state) => {
    const key = keyOf(kind, side);
    const clean = {
      allyPicks: removeHero(state.allyPicks, heroId),
      enemyPicks: removeHero(state.enemyPicks, heroId),
      allyBans: removeHero(state.allyBans, heroId),
      enemyBans: removeHero(state.enemyBans, heroId)
    };
    return { ...clean, [key]: setSlot(clean[key], slot, heroId) };
  }),
  clearSlot: (kind, side, slot) => set((state) => {
    const key = keyOf(kind, side);
    return { [key]: setSlot(state[key], slot, null) };
  }),
  clear: () => set({ allyPicks: emptySlots(), enemyPicks: emptySlots(), allyBans: emptySlots(), enemyBans: emptySlots() })
}));
