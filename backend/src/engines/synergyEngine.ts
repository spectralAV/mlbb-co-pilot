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

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function toList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : String(value ?? "").split(/[,/]/).map((item) => item.trim()).filter(Boolean);
}

function heroId(hero: any) {
  return Number(hero?.id ?? hero?.hero_id ?? hero?.raw?.id ?? hero?.raw?.hero_id);
}

function heroName(hero: any) {
  return String(hero?.name ?? hero?.hero_name ?? hero?.raw?.hero_name ?? "").trim();
}

function heroIcon(hero: any) {
  return hero?.icon ?? hero?.icon_url ?? hero?.img_src ?? hero?.raw?.img_src;
}

export function suggestHeroSynergies(allHeroes: any[], allyHeroIds: unknown[], options: { lane?: string; role?: string } = {}) {
  const selected = new Set((allyHeroIds ?? []).map((id) => Number(id)).filter(Number.isFinite));
  const allies = allHeroes.filter((hero) => selected.has(heroId(hero)));
  const allyRelationIds = new Set(allies.flatMap((hero) => [
    ...(hero?.relations?.assist ?? []),
    ...(hero?.relations?.strong ?? []),
    ...(hero?.raw?.relation?.assist?.target_hero_id ?? [])
  ]).map(Number).filter(Number.isFinite));
  const lane = normalize(options.lane);
  const role = normalize(options.role);

  return allHeroes
    .filter((hero) => {
      const id = heroId(hero);
      if (!Number.isFinite(id) || selected.has(id)) return false;
      const lanes = toList(hero?.lanes ?? hero?.lane ?? hero?.raw?.lane).map(normalize);
      const roles = toList(hero?.roles ?? hero?.role ?? hero?.raw?.role).map(normalize);
      return (!lane || lanes.includes(lane)) && (!role || roles.includes(role));
    })
    .map((hero) => {
      const base = teamSynergy(hero, allies);
      const id = heroId(hero);
      const reasons = [...base.reasons];
      let score = base.score;
      if (allyRelationIds.has(id)) {
        score += 12;
        reasons.push("Appears in allied hero relation data");
      }
      if (!reasons.length) reasons.push("Balanced fill for current ally picks");
      return {
        heroId: id,
        heroName: heroName(hero),
        imgSrc: heroIcon(hero),
        role: toList(hero?.roles ?? hero?.role ?? hero?.raw?.role),
        lane: toList(hero?.lanes ?? hero?.lane ?? hero?.raw?.lane),
        speciality: toList(hero?.specialties ?? hero?.speciality ?? hero?.raw?.speciality),
        score: Math.min(99, Math.round(score)),
        reasons,
        synergyHeroes: allies.map((ally) => ({ id: heroId(ally), name: heroName(ally) }))
      };
    })
    .sort((a, b) => b.score - a.score);
}
