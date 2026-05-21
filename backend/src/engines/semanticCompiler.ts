import { cache } from "../services/cacheService.js";
import { iconUrl } from "../services/semanticRegistry.js";

function pushUnique(arr:string[], ...values:string[]) { for (const v of values) if (v && !arr.includes(v)) arr.push(v); }
function textOf(...values:any[]) { return values.filter(Boolean).join(" ").toLowerCase(); }
function matchAny(text:string, terms:string[]) { return terms.some(t => text.includes(t)); }

export function compileItem(item:any) {
  const t = textOf(item.name,item.category,item.tags,item.stats_other,item.passive_name,item.passive_description,item.passive_effects);
  const semantic_tags:string[]=[]; const counter_profiles:string[]=[]; const synergy_profiles:string[]=[]; const tactical_notes:string[]=[];
  if (matchAny(t,["lifebane","regen","hp regen","healing","heal","shield"])) { pushUnique(semantic_tags,"anti-sustain"); if(t.includes("lifebane")||t.includes("reduce")){pushUnique(semantic_tags,"antiheal","anti-shield"); pushUnique(counter_profiles,"regen","shield","healing","lifesteal"); tactical_notes.push("Counters sustain, healing, shield, or regen patterns.");}}
  if (matchAny(t,["magic defense","magic damage taken","magic penetration"])) { pushUnique(semantic_tags,"magic-defense-response","magic-penetration"); pushUnique(counter_profiles,"magic-damage","magic-defense"); }
  if (matchAny(t,["physical defense","physical damage","crit damage reduction"])) { pushUnique(semantic_tags,"physical-defense-response"); pushUnique(counter_profiles,"physical-damage","crit"); }
  if (t.includes("true damage")) pushUnique(semantic_tags,"true-damage");
  if (t.includes("slow")) { pushUnique(semantic_tags,"slow","kite-control"); pushUnique(counter_profiles,"mobility","chase"); }
  if (matchAny(t,["movement speed","mobility"])) pushUnique(semantic_tags,"mobility");
  if (matchAny(t,["attack speed"])) { pushUnique(semantic_tags,"attack-speed"); pushUnique(synergy_profiles,"basic-attack","marksman","on-hit"); }
  if (matchAny(t,["cooldown","ultimate cooldown"])) { pushUnique(semantic_tags,"cooldown-reduction","skill-cycling"); pushUnique(synergy_profiles,"skill-spam","caster"); }
  if (matchAny(t,["penetration","defense reduction"])) { pushUnique(semantic_tags,"penetration","tank-shred"); pushUnique(counter_profiles,"frontline","tank"); }
  if (matchAny(t,["burst","execute","below 50%","lethality"])) pushUnique(semantic_tags,"burst","finisher");
  if (matchAny(t,["lifesteal","spell vamp","hybrid lifesteal"])) pushUnique(semantic_tags,"sustain");
  if (String(item.category).toLowerCase().includes("defense")) pushUnique(semantic_tags,"frontline","survivability");
  if (String(item.category).toLowerCase().includes("magic")) pushUnique(semantic_tags,"magic-damage");
  if (String(item.category).toLowerCase().includes("attack")) pushUnique(semantic_tags,"physical-damage");
  return { ...item, semantic_tags, counter_profiles, synergy_profiles, tactical_notes, icon_url: iconUrl.item(item.image_path) };
}

export function compileTalent(talent:any) {
  const t=textOf(talent.name,talent.benefits,talent.description); const tags:string[]=[]; const profile:string[]=[];
  if (talent.section===1) pushUnique(profile,"baseline-stat-bias");
  if (talent.section===2) pushUnique(profile,"strategic-modifier");
  if (talent.section===3) pushUnique(profile,"combat-execution-engine");
  if (matchAny(t,["movement","jungle","river"])) pushUnique(tags,"mobility","rotation");
  if (matchAny(t,["penetration","adaptive attack","damage","scorch"])) pushUnique(tags,"damage-amplification");
  if (matchAny(t,["spell vamp","regen","recover","hp"])) pushUnique(tags,"sustain");
  if (matchAny(t,["cooldown","ultimate"])) pushUnique(tags,"cooldown-optimization");
  if (matchAny(t,["lord","turtle","jungle"])) pushUnique(tags,"objective-tempo");
  if (matchAny(t,["slow","attack speed"])) pushUnique(tags,"control","anti-carry");
  return { ...talent, semantic_tags:tags, tactical_profile:profile, icon_url: iconUrl.talent(talent.img_src) };
}

export function compileHero(hero:any) {
  const t=textOf(hero.name,hero.roles?.join(" "),hero.lanes?.join(" "),hero.specialties?.join(" ")); const tags:string[]=[]; const strengths:string[]=[]; const weaknesses:string[]=[]; const playstyle:string[]=[];
  if (t.includes("assassin")) { pushUnique(tags,"assassin","pickoff","backline-access"); pushUnique(weaknesses,"hard-cc","vision-control"); }
  if (t.includes("tank")) { pushUnique(tags,"frontline","engage-durability"); pushUnique(strengths,"space-creation"); }
  if (t.includes("marksman")) { pushUnique(tags,"dps-carry","scaling"); pushUnique(weaknesses,"dive","burst"); }
  if (t.includes("mage")) { pushUnique(tags,"magic-damage","spell-caster"); }
  if (t.includes("support")) { pushUnique(tags,"utility","team-enabler"); }
  if (t.includes("fighter")) { pushUnique(tags,"bruiser","skirmisher"); }
  if (matchAny(t,["crowd control","control","initiator"])) { pushUnique(tags,"cc","engage","setup"); pushUnique(strengths,"teamfight-initiation"); }
  if (matchAny(t,["chase","charge"])) { pushUnique(tags,"mobility","dive"); pushUnique(playstyle,"aggressive-entry"); }
  if (t.includes("regen")) { pushUnique(tags,"sustain"); pushUnique(weaknesses,"antiheal"); }
  if (t.includes("poke")) pushUnique(tags,"poke","zone-pressure");
  if (t.includes("burst")) pushUnique(tags,"burst","pickoff");
  if (t.includes("push")) pushUnique(tags,"split-push","wave-pressure");
  if (t.includes("magic damage")) pushUnique(tags,"magic-burst");
  if (t.includes("finisher")) pushUnique(tags,"execute-pressure");
  return { ...hero, semantic_tags:tags, strengths, weaknesses, playstyle };
}

export const semanticCompiler = {
  async compileItems(){ const items=await cache.read<any[]>("items.json",[]); const compiled=items.map(compileItem); await cache.write("compiled-items.json",compiled); await cache.setMetadata("compiled-items",{count:compiled.length,syncedAt:new Date().toISOString()}); return compiled; },
  async compileHeroes(){ const heroes=await cache.read<any[]>("heroes.json",[]); const compiled=heroes.map(compileHero); await cache.write("compiled-heroes.json",compiled); await cache.setMetadata("compiled-heroes",{count:compiled.length,syncedAt:new Date().toISOString()}); return compiled; },
  async compileTalents(){ const talents=await cache.read<any[]>("talents.json",[]); const compiled=talents.map(compileTalent); await cache.write("compiled-talents.json",compiled); await cache.setMetadata("compiled-talents",{count:compiled.length,syncedAt:new Date().toISOString()}); return compiled; },
  async compileAll(){ const items=await this.compileItems(); const heroes=await this.compileHeroes(); const talents=await this.compileTalents(); return { items:items.length, heroes:heroes.length, talents:talents.length }; }
};
