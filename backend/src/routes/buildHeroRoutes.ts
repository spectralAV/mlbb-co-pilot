import type { FastifyInstance } from "fastify";
import { cache } from "../services/cacheService.js";

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function pickArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data?.builds)) return payload.data.builds;
  if (Array.isArray(payload?.builds)) return payload.builds;
  return [];
}

function buildHeroName(build: any): string {
  return String(build?.hero_name ?? build?.heroName ?? build?.hero?.name ?? build?.hero?.hero_name ?? build?.hero ?? "");
}

export async function buildHeroRoutes(app: FastifyInstance) {
  app.get("/api/builds/hero/:heroName", async (req) => {
    const { heroName } = req.params as { heroName: string };
    const target = normalizeName(heroName);

    try {
      const response = await fetch(`https://mlbb.io/api/item/item-build/hero/${encodeURIComponent(heroName)}`, {
        headers: {
          accept: "application/json, text/plain, */*",
          "user-agent": "MLBB-Co-Pilot/0.4.1-live-cockpit"
        }
      });

      if (response.ok) {
        const json = await response.json();
        const builds = pickArray(json);
        return { success: true, source: "mlbb.io:hero-specific", heroName, count: builds.length, data: builds };
      }
    } catch (error) {
      app.log.warn({ error, heroName }, "hero-specific build fetch failed, using cache fallback");
    }

    const cached = await cache.read("builds.json", []);
    const filtered = pickArray(cached).filter((build) => normalizeName(buildHeroName(build)) === target);
    return { success: true, source: "cache:fallback-filtered", heroName, count: filtered.length, data: filtered };
  });
}
