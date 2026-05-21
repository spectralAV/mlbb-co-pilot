import { cache } from "../services/cacheService.js";
import { readRuntime } from "../runtime/RuntimeStore.js";
import { suggestBans } from "./banEngine.js";
import { scoreDraftHero } from "./scoreHero.js";

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function matchesPick(hero: any, pick: unknown) {
  const value = normalize(pick);
  return normalize(hero?.id) === value || normalize(hero?.name ?? hero?.hero_name) === value;
}

function legacyDraftResponse(state: any, allHeroes: any[], ally: any[], enemy: any[]) {
  const warnings:any[] = [];
  const allyTags = new Set(ally.flatMap((h:any)=>h.semantic_tags??[]));
  if (!allyTags.has("frontline")) warnings.push({ id:"no-frontline", severity:"high", title:"No clear frontline", message:"Your draft may lack someone to start fights or absorb pressure." });
  if (!allyTags.has("cc")) warnings.push({ id:"low-cc", severity:"medium", title:"Low CC density", message:"Your team may struggle to lock mobile enemies." });
  if (enemy.some((h:any)=>h.semantic_tags?.includes("sustain"))) warnings.push({ id:"antiheal-needed", severity:"medium", title:"Enemy sustain detected", message:"Prepare antiheal / anti-sustain itemization." });
  const picked = new Set([...(state.allyPicks??[]), ...(state.enemyPicks??[]), ...(state.allyBans??[]), ...(state.enemyBans??[]), ...(state.bans??[])].map(normalize));
  const recs = allHeroes.filter(h=>!picked.has(normalize(h.id)) && !picked.has(normalize(h.name ?? h.hero_name))).map((h:any)=>({ heroId:h.id, score: scoreHero(h, allyTags, enemy), reasons:h.semantic_tags?.slice(0,4)??[] })).sort((a,b)=>b.score-a.score).slice(0,8);
  return { recommendations: recs, warnings, allyIdentity:Array.from(allyTags), enemyIdentity:Array.from(new Set(enemy.flatMap((h:any)=>h.semantic_tags??[]))) };
}

export async function analyzeDraft(state:any) {
  const heroes = await cache.read<any[]>("compiled-heroes.json", []);
  const allHeroes = heroes.length ? heroes : await cache.read<any[]>("heroes.json", []);
  const runtime = await readRuntime();
  const runtimeByName = new Map((runtime?.heroes ?? []).map((h:any) => [normalize(h.name), h]));
  const ally = allHeroes.filter(h => (state.allyPicks ?? []).some((pick: unknown) => matchesPick(h, pick)));
  const enemy = allHeroes.filter(h => (state.enemyPicks ?? []).some((pick: unknown) => matchesPick(h, pick)));
  const picked = new Set([...(state.allyPicks??[]), ...(state.enemyPicks??[]), ...(state.allyBans??[]), ...(state.enemyBans??[]), ...(state.bans??[])].map(normalize));
  const candidates = allHeroes.filter((h) => !picked.has(normalize(h.id)) && !picked.has(normalize(h.name ?? h.hero_name)));
  const scored = candidates.map((hero) => scoreDraftHero(hero, {
    allies: ally,
    enemies: enemy,
    heroPool: state.myHeroPool ?? [],
    role: state.myRole,
    runtimeHero: runtimeByName.get(normalize(hero.name ?? hero.hero_name))
  })).sort((a, b) => b.score - a.score);

  const bestPick = scored[0] ?? null;
  const avoidPicks = scored.slice(-3).reverse().filter((pick) => pick.score < 55).map((pick) => ({
    hero: pick.hero,
    reason: pick.risks[0] ?? "Lower fit into the current draft"
  }));

  return {
    ok: true,
    bestPick,
    backupPicks: scored.slice(1, 4).map(({ hero, score }) => ({ hero, score })),
    avoidPicks,
    banSuggestions: suggestBans(state, enemy),
    ...legacyDraftResponse(state, allHeroes, ally, enemy)
  };
}
function scoreHero(h:any, allyTags:Set<string>, enemy:any[]) {
  let s=50;
  const tags = new Set(h.semantic_tags ?? []);
  if (!allyTags.has("frontline") && tags.has("frontline")) s+=25;
  if (!allyTags.has("cc") && tags.has("cc")) s+=18;
  if (enemy.some((e:any)=>e.semantic_tags?.includes("mobility")) && tags.has("cc")) s+=10;
  if (enemy.some((e:any)=>e.semantic_tags?.includes("sustain")) && tags.has("burst")) s+=4;
  return s;
}
