import { MLBB_IO_BASE } from "../config.js";
import { cache } from "./cacheService.js";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MLBB_IO_BASE}${path}`, {
    headers: { accept: "application/json, text/plain, */*", "user-agent": "MLBB-Co-Pilot/0.2" }
  });
  if (!res.ok) throw new Error(`mlbb.io ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${MLBB_IO_BASE}${path}`, {
    method: "POST",
    headers: { accept: "application/json, text/plain, */*", "content-type": "application/json", "user-agent": "MLBB-Co-Pilot/0.2" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`mlbb.io ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}
export function normalizeHero(raw: any) {
  return {
    id: Number(raw.id ?? raw.hero_id),
    name: String(raw.hero_name ?? raw.name),
    roles: splitCsv(raw.role),
    lanes: splitCsv(raw.lane),
    specialties: splitCsv(raw.speciality ?? raw.specialties),
    icon: String(raw.img_src ?? raw.icon ?? ""),
    raw
  };
}
export class MlbbIoService {
  async syncHeroes() { const json:any = await getJson("/api/hero/all-heroes"); const heroes=(json.data??[]).map(normalizeHero); await cache.write("heroes.json", heroes); await cache.setMetadata("heroes",{count:heroes.length,syncedAt:new Date().toISOString()}); return heroes; }
  async syncHeroTiers() { const json:any = await getJson("/api/hero/hero-tiers"); const data=json.data?.heroes ?? json.data ?? []; await cache.write("tiers.json", data); await cache.setMetadata("tiers",{count:data.length,syncedAt:new Date().toISOString()}); return data; }
  async syncItems() { const json:any = await getJson("/api/item/all-items"); const data=json.data??[]; await cache.write("items.json", data); await cache.setMetadata("items",{count:data.length,syncedAt:new Date().toISOString()}); return data; }
  async syncBuilds() { const json:any = await getJson("/api/item/latest-item-builds"); const data=json.data??[]; await cache.write("builds.json", data); await cache.setMetadata("builds",{count:data.length,syncedAt:new Date().toISOString()}); return data; }
  async syncEmblems() { const json:any = await getJson("/api/emblem/main-emblems"); const data=json.data??[]; await cache.write("emblems.json", data); await cache.setMetadata("emblems",{count:data.length,syncedAt:new Date().toISOString()}); return data; }
  async syncTalents() { const json:any = await getJson("/api/emblem/ability-emblems"); const data=json.data??[]; await cache.write("talents.json", data); await cache.setMetadata("talents",{count:data.length,syncedAt:new Date().toISOString()}); return data; }
  async syncAll() { const result:Record<string,number>={}; result.heroes=(await this.syncHeroes()).length; result.tiers=(await this.syncHeroTiers()).length; result.items=(await this.syncItems()).length; result.builds=(await this.syncBuilds()).length; result.emblems=(await this.syncEmblems()).length; result.talents=(await this.syncTalents()).length; return result; }
  async heroBuilds(heroName: string) { const json:any = await getJson(`/api/item/item-build/hero/${encodeURIComponent(heroName)}`); return json.data ?? []; }
  async combinedRecommendations(allyHeroes:number[], enemyHeroes:number[]) { return postJson("/api/hero/combined-recommendations", { allyHeroes, enemyHeroes }); }
  async counterPickSuggestions(enemyHeroes:number[]) { return postJson("/api/hero/counter-pick-suggestions", { enemyHeroes }); }
}
export const mlbbIo = new MlbbIoService();
