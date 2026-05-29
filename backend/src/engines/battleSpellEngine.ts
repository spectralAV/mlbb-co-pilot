import type { DraftLane } from "../services/playerProfile.js";

type SpellFact = { spell?: string; slot?: number; confidence?: number };

type SpellOption = {
  spell: string;
  score: number;
  reason: string;
};

function hasTag(heroes: any[], terms: string[]) {
  return heroes.some((hero) => {
    const text = [
      ...(hero?.semantic_tags ?? []),
      ...(hero?.strengths ?? []),
      ...(hero?.specialties ?? []),
    ].join(" ").toLowerCase();
    return terms.some((term) => text.includes(term));
  });
}

function add(options: SpellOption[], spell: string, score: number, reason: string) {
  if (!options.some((option) => option.spell === spell)) options.push({ spell, score, reason });
}

export function recommendBattleSpells(input: {
  selectedLane?: DraftLane;
  enemies?: any[];
  allies?: any[];
  allySpells?: SpellFact[];
  selfSlot?: number;
}) {
  const lane = input.selectedLane;
  const enemies = input.enemies ?? [];
  const options: SpellOption[] = [];
  const enemyHasControl = hasTag(enemies, ["cc", "crowd control", "stun", "suppress", "immobil", "knock"]);
  const enemyHasBurst = hasTag(enemies, ["burst", "execute", "backline-access"]);
  const detectedSelfSpell = input.allySpells?.find((fact) => fact.slot === input.selfSlot)?.spell ?? null;

  if (lane === "jungle") {
    add(options, "Retribution", 100, "Required for jungle objective control and farm tempo.");
  }
  if (enemyHasControl && lane !== "jungle") {
    add(options, "Purify", 95, "Enemy draft shows strong crowd control; cleanse protects your engage or escape.");
  }
  if (enemyHasBurst && (lane === "gold" || lane === "mid")) {
    add(options, "Aegis", 78, "An extra shield can preserve a carry through enemy burst.");
  }
  if (lane === "roam" || lane === "exp") {
    add(options, "Flicker", 84, "Reliable engage and disengage option for side-lane or frontline play.");
    add(options, "Vengeance", 72, "Alternative when you expect to absorb sustained damage.");
  } else if (lane !== "jungle") {
    add(options, "Flicker", 84, "Reliable repositioning for lane pressure and team fights.");
  }
  if (!options.length) {
    add(options, "Flicker", 75, "Safe flexible option until lane and enemy control are confirmed.");
  }
  if (detectedSelfSpell && !options.some((option) => option.spell === detectedSelfSpell)) {
    add(options, detectedSelfSpell, 65, "Currently detected on your draft slot.");
  }

  return {
    detectedSelfSpell,
    enemyHasControl,
    recommendations: options.sort((left, right) => right.score - left.score).slice(0, 3),
  };
}
