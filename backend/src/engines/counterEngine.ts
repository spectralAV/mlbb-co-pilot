function text(value: unknown) {
  return String(value ?? "").toLowerCase();
}

export function matchupQuality(hero: any, enemies: any[]) {
  const tags = new Set((hero?.semantic_tags ?? []).map(text));
  let score = 55;
  const reasons: string[] = [];
  const risks: string[] = [];

  if (enemies.some((e) => (e.semantic_tags ?? []).map(text).includes("mobility")) && tags.has("cc")) {
    score += 14;
    reasons.push("Crowd control helps contain mobile enemy picks");
  }
  if (enemies.some((e) => (e.semantic_tags ?? []).map(text).includes("sustain")) && (tags.has("burst") || tags.has("anti-sustain"))) {
    score += 8;
    reasons.push("Good answer into enemy sustain patterns");
  }
  if (enemies.some((e) => text(e.name).includes("saber")) && !tags.has("tank") && !tags.has("frontline")) {
    score -= 10;
    risks.push("Watch for Saber single-target burst");
  }
  if (enemies.some((e) => (e.semantic_tags ?? []).map(text).includes("hard-cc")) && tags.has("dive")) {
    score -= 8;
    risks.push("Enemy lockdown can punish forced dives");
  }

  return { score, reasons, risks };
}
