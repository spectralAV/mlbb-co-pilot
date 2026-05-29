import type { HeroRuntime, Lane, Role, RuntimeBundle } from '../types/runtime.js';

function cleanIds(input: unknown): number[] {
  return Array.isArray(input) ? input.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
}

function extractRoles(sortid: any[]): Role[] {
  if (!Array.isArray(sortid)) return [];
  return sortid.filter(Boolean).map((r) => ({
    id: Number(r?.data?.sort_id),
    title: String(r?.data?.sort_title ?? '').replace(/^./, (c) => c.toUpperCase()),
    icon: r?.data?.sort_icon
  })).filter((r) => r.id && r.title);
}

function extractLanes(roadsort: any[]): Lane[] {
  if (!Array.isArray(roadsort)) return [];
  return roadsort.filter(Boolean).map((r) => ({
    id: Number(r?.data?.road_sort_id),
    title: String(r?.data?.road_sort_title ?? ''),
    icon: r?.data?.road_sort_icon
  })).filter((r) => r.id && r.title);
}

export function compileRuntime(directoryResponse: any, metaResponse: any): RuntimeBundle {
  const metaByHero = new Map<number, any>();
  for (const row of metaResponse?.data?.records ?? []) {
    const d = row.data ?? {};
    metaByHero.set(Number(d.main_heroid), d);
  }

  const heroes: HeroRuntime[] = (directoryResponse?.data?.records ?? []).map((row: any) => {
    const d = row.data ?? {};
    const hero = d.hero?.data ?? {};
    const heroId = Number(d.hero_id);
    const meta = metaByHero.get(heroId);

    return {
      id: heroId,
      channelId: Number(row.id),
      name: String(hero.name ?? `Hero ${heroId}`),
      icon: hero.smallmap,
      head: hero.head,
      portrait: hero.smallmap,
      painting: hero.painting,
      roles: extractRoles(hero.sortid),
      lanes: extractLanes(hero.roadsort),
      relations: {
        assist: cleanIds(d.relation?.assist?.target_hero_id),
        strong: cleanIds(d.relation?.strong?.target_hero_id),
        weak: cleanIds(d.relation?.weak?.target_hero_id)
      },
      meta: meta ? {
        winRate: meta.main_hero_win_rate,
        banRate: meta.main_hero_ban_rate,
        appearanceRate: meta.main_hero_appearance_rate,
        topSynergies: Array.isArray(meta.sub_hero) ? meta.sub_hero.map((s: any) => ({
          heroId: Number(s.heroid),
          deltaWinRate: Number(s.increase_win_rate),
          icon: s.hero?.data?.head
        })).filter((s: any) => s.heroId) : []
      } : undefined
    } satisfies HeroRuntime;
  }).filter((h: HeroRuntime) => h.id && h.name);

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      heroDirectoryCount: directoryResponse?.data?.total,
      heroMetaCount: metaResponse?.data?.total
    },
    heroes
  };
}
