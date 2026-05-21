import { useEffect, useMemo, useState } from "react";
import { apiGet, getHeroBuild } from "../api/client";
import { resolveEmblemIcon, resolveHeroIcon, resolveItemIcon, resolveSpellIcon, resolveTalentIcon } from "../utils/assetResolver";

type Hero = Record<string, any>;
type Item = Record<string, any>;
type Build = Record<string, any>;

function safeArray<T>(value: any): T[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.data?.data)) return value.data.data;
  if (Array.isArray(value?.data?.builds)) return value.data.builds;
  if (Array.isArray(value?.builds)) return value.builds;
  return [];
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function displayName(value: any, fallback = "Unknown") {
  return String(value?.display_name ?? value?.name ?? value?.hero_name ?? value?.heroName ?? fallback);
}

function pickBuildHeroName(build: Build) {
  return String(build?.hero_name ?? build?.heroName ?? build?.hero?.name ?? build?.hero?.hero_name ?? build?.hero ?? "Unknown Hero");
}

function pickItemIds(build: Build): Array<string | number> {
  const candidates = [build?.items, build?.item_ids, build?.itemIds, build?.build_items, build?.equipment, build?.item_build];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? item?.id ?? item?.item_id ?? item?.itemId ?? item?.name : item);
    if (typeof value === "string") return value.split(/[,|\s]+/).map((part) => part.trim()).filter(Boolean);
  }
  return [build?.item1, build?.item2, build?.item3, build?.item4, build?.item5, build?.item6].filter(Boolean);
}

function pickTalentIds(build: Build): Array<string | number> {
  const candidates = [build?.talents, build?.talent_ids, build?.talentIds, build?.emblem_talents, build?.emblems?.ability_ids];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.map((talent) => typeof talent === "object" ? talent?.id ?? talent?.talent_id ?? talent?.name : talent);
    if (typeof value === "string") return value.split(/[,|\s]+/).map((part) => part.trim()).filter(Boolean);
  }
  return [build?.talent1, build?.talent2, build?.talent3].filter(Boolean);
}

function Img({ src, alt, className }: { src?: string; alt?: string; className?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <span className={`${className ?? ""} inline-flex items-center justify-center rounded-lg bg-slate-800 text-slate-400`}>?</span>;
  return <img src={src} alt={alt ?? ""} className={className} onError={() => setBad(true)} />;
}

export function BuildLab() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [emblems, setEmblems] = useState<Item[]>([]);
  const [talents, setTalents] = useState<Item[]>([]);
  const [selectedHero, setSelectedHero] = useState("");
  const [builds, setBuilds] = useState<Build[]>([]);
  const [source, setSource] = useState("not loaded");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [heroRaw, itemRaw, emblemRaw, talentRaw] = await Promise.all([
        apiGet<any>("/api/cache/heroes").catch(() => []),
        apiGet<any>("/api/semantic/items").catch(() => []),
        apiGet<any>("/api/cache/emblems").catch(() => []),
        apiGet<any>("/api/cache/talents").catch(() => [])
      ]);
      const heroList = safeArray<Hero>(heroRaw);
      setHeroes(heroList);
      setItems(safeArray<Item>(itemRaw));
      setEmblems(safeArray<Item>(emblemRaw));
      setTalents(safeArray<Item>(talentRaw));
      if (!selectedHero && heroList.length) setSelectedHero(displayName(heroList[0]));
    })();
  }, []);

  const heroByName = useMemo(() => new Map(heroes.map((hero) => [normalizeKey(displayName(hero)), hero])), [heroes]);
  const itemById = useMemo(() => {
    const map = new Map<string, Item>();
    for (const item of items) {
      if (item.id != null) map.set(String(item.id), item);
      map.set(normalizeKey(displayName(item, "")), item);
    }
    return map;
  }, [items]);
  const emblemByName = useMemo(() => new Map(emblems.map((emblem) => [normalizeKey(String(emblem.name ?? "").replace(/ emblem$/i, "")), emblem])), [emblems]);
  const talentById = useMemo(() => {
    const map = new Map<string, Item>();
    for (const talent of talents) {
      if (talent.id != null) map.set(String(talent.id), talent);
      map.set(normalizeKey(displayName(talent, "")), talent);
    }
    return map;
  }, [talents]);

  async function analyzeSelectedHero() {
    if (!selectedHero) return;
    setLoading(true);
    setBuilds([]);
    try {
      const json = await getHeroBuild(selectedHero);
      setBuilds(safeArray<Build>(json));
      setSource(json?.source ?? "hero-specific");
    } catch {
      setSource("failed");
    } finally {
      setLoading(false);
    }
  }

  const situational = useMemo(() => {
    const buckets: Record<string, Item[]> = { Antiheal: [], AntiMagic: [], AntiPhysical: [], Mobility: [] };
    for (const item of items) {
      const tags = new Set([...(item.semantic_tags ?? []), ...(item.counter_profiles ?? []), ...(item.synergy_profiles ?? [])].map(normalizeKey));
      if (tags.has("antiheal") || tags.has("antisustain") || tags.has("antishield")) buckets.Antiheal.push(item);
      if (tags.has("magicdefenseresponse") || tags.has("antimagic") || tags.has("antiburst")) buckets.AntiMagic.push(item);
      if (tags.has("physicaldefenseresponse") || tags.has("critcounter") || tags.has("basicattackcounter")) buckets.AntiPhysical.push(item);
      if (tags.has("mobility") || tags.has("slow") || tags.has("kitecontrol")) buckets.Mobility.push(item);
    }
    return buckets;
  }, [items]);

  function renderBuild(build: Build, index: number) {
    const name = pickBuildHeroName(build);
    const hero = heroByName.get(normalizeKey(name));
    const spell = String(build?.battle_spell ?? build?.battleSpell ?? build?.spell ?? build?.spell_name ?? "");
    const emblemName = String(build?.main_emblem ?? build?.mainEmblem ?? build?.emblem ?? build?.emblem_name ?? "");
    const emblem = emblemByName.get(normalizeKey(emblemName.replace(/ emblem$/i, "")));
    const buildItems = pickItemIds(build).map((id) => itemById.get(String(id)) ?? itemById.get(normalizeKey(id))).filter(Boolean) as Item[];
    const buildTalents = pickTalentIds(build).map((id) => talentById.get(String(id)) ?? talentById.get(normalizeKey(id))).filter(Boolean) as Item[];
    const tags = Array.from(new Set(buildItems.flatMap((item) => item.semantic_tags ?? []))).slice(0, 14);

    return <article key={build?.id ?? build?.build_id ?? `${name}-${index}`} className="card p-4">
      <div className="flex gap-4">
        <Img src={resolveHeroIcon(hero ?? build)} alt={name} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-white">{name}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <span>by {build?.author ?? build?.username ?? build?.user_name ?? "Unknown"}</span>
                {spell && <><Img src={resolveSpellIcon(spell)} alt={spell} className="h-5 w-5 rounded object-cover" /><span>{spell}</span></>}
              </div>
            </div>
            <div className="text-xs text-slate-300">{build?.lane ?? hero?.lane ?? build?.role ?? hero?.role ?? "Any"}</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {buildItems.map((item) => <div key={`${build?.id}-${item.id ?? item.name}`} className="w-28 rounded-lg border border-white/10 bg-white/5 p-2 text-center">
              <Img src={resolveItemIcon(item)} alt={displayName(item)} className="mx-auto h-9 w-9 rounded object-cover" />
              <div className="mt-1 truncate text-[11px] text-white">{displayName(item)}</div>
            </div>)}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {emblemName && <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-2 py-1 text-xs text-cyan-100"><Img src={resolveEmblemIcon(emblem ?? emblemName)} alt={emblemName} className="h-4 w-4 rounded" />{emblemName}</span>}
            {buildTalents.map((talent) => <span key={`${build?.id}-talent-${talent.id ?? talent.name}`} className="inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-1 text-xs text-violet-100"><Img src={resolveTalentIcon(talent)} alt={displayName(talent)} className="h-4 w-4 rounded" />{displayName(talent)}</span>)}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">{tags.map((tag) => <span key={`${build?.id}-tag-${tag}`} className="chip">{tag}</span>)}</div>
          {(build?.description ?? build?.note ?? build?.guide ?? build?.title) && <p className="mt-3 line-clamp-3 text-sm text-slate-200">{build.description ?? build.note ?? build.guide ?? build.title}</p>}
          <div className="mt-3 text-sm text-slate-400">Likes {build?.likes ?? build?.likes_count ?? build?.like_count ?? 0} / Dislikes {build?.dislikes ?? build?.dislikes_count ?? build?.dislike_count ?? 0}</div>
        </div>
      </div>
    </article>;
  }

  return <div className="space-y-6">
    <header>
      <h2 className="text-3xl font-black">Build Lab</h2>
      <p className="mt-1 text-slate-400">Hero-specific builds, semantic item tags, emblems, talents, and asset-resolved icons.</p>
    </header>

    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={selectedHero} onChange={(e) => setSelectedHero(e.target.value)} className="input min-w-48">
          {heroes.map((hero) => <option key={String(hero.id ?? displayName(hero))} value={displayName(hero)}>{displayName(hero)}</option>)}
        </select>
        <button onClick={analyzeSelectedHero} disabled={loading || !selectedHero} className="btn">{loading ? "Loading..." : "Analyze Build"}</button>
        <span className="text-sm text-slate-400">Source: {source}</span>
      </div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <section className="space-y-4">{builds.length ? builds.map(renderBuild) : <div className="card p-6 text-slate-300">Select a hero and analyze to load hero-specific builds.</div>}</section>
      <aside className="card space-y-4 p-4">
        <h3 className="text-xl font-black text-white">Situational Intelligence</h3>
        {(Object.entries(situational) as [string, Item[]][]).map(([category, categoryItems]) => <section key={category}>
          <h4 className="mb-2 font-bold text-white">{category}</h4>
          <div className="space-y-2">{categoryItems.slice(0, 4).map((item) => <div key={`${category}-${item.id ?? item.name}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2"><Img src={resolveItemIcon(item)} alt={displayName(item)} className="h-8 w-8 rounded object-cover" /><strong>{displayName(item)}</strong></div>
            <div className="mt-2 flex flex-wrap gap-1">{((item.semantic_tags as string[] | undefined) ?? []).slice(0, 5).map((tag: string) => <span key={`${item.id}-${tag}`} className="chip">{tag}</span>)}</div>
          </div>)}</div>
        </section>)}
      </aside>
    </div>
  </div>;
}

export default BuildLab;
