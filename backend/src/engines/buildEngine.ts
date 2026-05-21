import { cache } from "../services/cacheService.js";
import { mlbbIo } from "../services/mlbbIoService.js";
import { semanticRegistry } from "../services/semanticRegistry.js";

function groupBySemantic(items:any[]) {
  return {
    antiheal: items.filter(i => i.semantic_tags?.includes("antiheal") || i.semantic_tags?.includes("anti-sustain")),
    antiMagic: items.filter(i => i.semantic_tags?.includes("magic-defense-response")),
    antiPhysical: items.filter(i => i.semantic_tags?.includes("physical-defense-response")),
    penetration: items.filter(i => i.semantic_tags?.includes("penetration") || i.semantic_tags?.includes("tank-shred")),
    mobility: items.filter(i => i.semantic_tags?.includes("mobility")),
    sustain: items.filter(i => i.semantic_tags?.includes("sustain"))
  };
}
async function resolveBuild(build:any, compiledItems:any[]) {
  const items = await Promise.all((build.items ?? []).map(async (id:number) => compiledItems.find(i=>Number(i.id)===Number(id)) ?? await semanticRegistry.resolveItem(id)));
  const mainEmblem = build.emblems?.main_id ? await semanticRegistry.resolveEmblem(build.emblems.main_id) : null;
  const talents = await Promise.all((build.emblems?.ability_ids ?? []).map((id:number) => semanticRegistry.resolveTalent(id)));
  const allTags = Array.from(new Set(items.flatMap((i:any)=>i.semantic_tags??[])));
  return { ...build, resolvedItems: items, resolvedEmblem: mainEmblem, resolvedTalents: talents, buildIdentity: allTags.slice(0,12) };
}
export async function analyzeBuild(heroId?: number, enemyHeroIds:number[] = []) {
  const [heroes, latestBuilds, compiledItems] = await Promise.all([
    cache.read<any[]>("heroes.json", []), cache.read<any[]>("builds.json", []), cache.read<any[]>("compiled-items.json", [])
  ]);
  const hero = heroes.find(h => Number(h.id) === Number(heroId));
  let heroBuilds:any[] = [];
  try { if (hero?.name) heroBuilds = await mlbbIo.heroBuilds(hero.name); } catch {}
  if (!heroBuilds.length) heroBuilds = latestBuilds.filter((b:any)=> !heroId || Number(b.hero_id) === Number(heroId));
  if (!heroBuilds.length) heroBuilds = latestBuilds;
  const resolvedBuilds = await Promise.all(heroBuilds.slice(0,12).map(b => resolveBuild(b, compiledItems)));
  return { hero, heroBuilds: resolvedBuilds, suggestions: groupBySemantic(compiledItems), usedFallback: !heroBuilds.some((b:any)=>Number(b.hero_id)===Number(heroId)) };
}
