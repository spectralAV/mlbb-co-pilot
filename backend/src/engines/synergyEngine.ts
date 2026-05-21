function lowerList(values: unknown[]) {
  return values.map((v) => String(v ?? "").toLowerCase());
}

export function teamSynergy(hero: any, allies: any[]) {
  const heroTags = new Set(lowerList(hero?.semantic_tags ?? []));
  const allyTags = new Set(allies.flatMap((ally) => lowerList(ally?.semantic_tags ?? [])));
  let score = 50;
  const reasons: string[] = [];

  if (!allyTags.has("frontline") && (heroTags.has("frontline") || heroTags.has("tank"))) {
    score += 22;
    reasons.push("Adds needed frontline for team fights");
  }
  if (!allyTags.has("cc") && heroTags.has("cc")) {
    score += 16;
    reasons.push("Adds needed crowd control");
  }
  if (allyTags.has("engage") && heroTags.has("burst")) {
    score += 10;
    reasons.push("Pairs well with allied engage windows");
  }
  if (allyTags.has("poke") && heroTags.has("siege")) {
    score += 8;
    reasons.push("Supports a patient poke and siege identity");
  }

  return { score, reasons };
}
