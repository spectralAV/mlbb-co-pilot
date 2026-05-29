import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Images, RefreshCw, ScanSearch, Search } from "lucide-react";
import { compileSkinPortraitSignatures, getSkinPortraitManifest, getSkinSignatureStatus, syncSkinPortraitManifest } from "../api/client";

type SkinPortrait = { id: string; name: string; fileName: string; imageUrl: string; source?: "official" | "wiki" };
type SkinHero = { heroId: number; heroName: string; sourcePage: string; portraits: SkinPortrait[] };
type SkinManifest = {
  source: string;
  provenance: string;
  syncedAt: string;
  heroes: SkinHero[];
  portraitCount: number;
};

function uniquePortraits(portraits: SkinPortrait[]) {
  return Array.from(new Map(portraits.map((skin) => [skin.id, skin])).values());
}

export function SkinGallery() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedHeroId, setSelectedHeroId] = useState<number | null>(null);
  const manifestQ = useQuery({
    queryKey: ["skin-portrait-manifest"],
    queryFn: async () => (await getSkinPortraitManifest()).data as SkinManifest,
  });
  const syncQ = useMutation({
    mutationFn: syncSkinPortraitManifest,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["skin-portrait-manifest"] }),
  });
  const signaturesQ = useQuery({
    queryKey: ["skin-signature-status"],
    queryFn: async () => (await getSkinSignatureStatus()).data as { portraitCount: number; referenceCount: number; compiledAt: string },
  });
  const compileQ = useMutation({
    mutationFn: compileSkinPortraitSignatures,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["skin-signature-status"] }),
  });
  const manifest = manifestQ.data;
  const heroes = useMemo(() => (manifest?.heroes ?? []).map((hero) => ({
    ...hero,
    portraits: uniquePortraits(hero.portraits),
  })), [manifest]);
  const totalPortraits = useMemo(() => heroes.reduce((total, hero) => total + hero.portraits.length, 0), [heroes]);
  const filteredHeroes = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? heroes.filter((hero) => hero.heroName.toLowerCase().includes(term)) : heroes;
  }, [heroes, query]);
  const activeHero = heroes.find((hero) => hero.heroId === selectedHeroId)
    ?? filteredHeroes[0]
    ?? heroes[0];
  const activePortraits = activeHero?.portraits ?? [];

  return <div className="skin-gallery">
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
      <div>
        <h2 className="text-3xl font-black text-white">Skin Gallery</h2>
        <p className="mt-1 text-sm text-slate-400">{totalPortraits} portraits / {heroes.length} heroes</p>
      </div>
      <div className="flex items-center gap-3">
        <a className="inline-flex min-h-11 items-center gap-2 text-sm text-cyan-200 hover:text-cyan-100" href="https://www.mobilelegends.com/hero" target="_blank" rel="noreferrer">
          Official Heroes <ExternalLink className="h-4 w-4" />
        </a>
        <a className="inline-flex min-h-11 items-center gap-2 text-sm text-cyan-200 hover:text-cyan-100" href={manifest?.source ?? "https://mobile-legends.fandom.com/wiki/"} target="_blank" rel="noreferrer">
          Skin Wiki <ExternalLink className="h-4 w-4" />
        </a>
        <button className="btn inline-flex items-center gap-2 !bg-cyan-600 hover:!bg-cyan-500" type="button" onClick={() => syncQ.mutate()} disabled={syncQ.isPending}>
          <RefreshCw className={`h-4 w-4 ${syncQ.isPending ? "animate-spin" : ""}`} />
          {syncQ.isPending ? "Indexing" : "Refresh"}
        </button>
        <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-cyan-300/30 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50" type="button" onClick={() => compileQ.mutate()} disabled={compileQ.isPending}>
          <ScanSearch className={`h-4 w-4 ${compileQ.isPending ? "animate-pulse" : ""}`} />
          {compileQ.isPending ? "Compiling" : "Compile CV"}
        </button>
      </div>
    </header>
    {signaturesQ.data?.compiledAt && <div className="mb-5 text-xs text-slate-500">
      CV signatures: {signaturesQ.data.portraitCount} portraits / {signaturesQ.data.referenceCount} references
    </div>}

    <div className="grid min-h-[calc(100vh-176px)] gap-5 xl:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="min-w-0 border-r border-white/10 pr-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
          <input className="input w-full !pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find hero" />
        </label>
        <div className="touch-scroll mt-4 max-h-[calc(100vh-240px)] space-y-1 overflow-y-auto pr-1">
          {filteredHeroes.map((hero) => <button
            key={hero.heroId}
            type="button"
            onClick={() => setSelectedHeroId(hero.heroId)}
            className={`flex min-h-12 w-full items-center justify-between rounded-md px-3 text-left text-sm transition ${activeHero?.heroId === hero.heroId ? "bg-cyan-500/15 text-cyan-100 ring-1 ring-cyan-300/40" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}
          >
            <span className="truncate font-semibold">{hero.heroName}</span>
            <span className="ml-3 text-xs text-slate-400">{hero.portraits.length}</span>
          </button>)}
        </div>
      </aside>

      <section className="min-w-0">
        {activeHero ? <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-2xl font-bold text-white">{activeHero.heroName}</h3>
              <p className="text-sm text-slate-400">{activePortraits.length} portraits</p>
            </div>
            <a className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-slate-200 hover:border-cyan-300/35" href={activeHero.sourcePage} target="_blank" rel="noreferrer">
              Wiki page <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <div key={activeHero.heroId} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {activePortraits.map((skin) => <figure key={`${activeHero.heroId}:${skin.id}`} className="group overflow-hidden rounded-md border border-white/10 bg-[#0a1323]">
              <div className="aspect-[240/390] overflow-hidden bg-[#111a28]">
                <img
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  src={`/api/vision/skins/portrait/${activeHero.heroId}/${encodeURIComponent(skin.id)}`}
                  alt={`${activeHero.heroName} - ${skin.name}`}
                  loading="lazy"
                />
              </div>
              <figcaption className="border-t border-white/10 px-3 py-2.5">
                <div className="truncate text-sm font-semibold text-white">{skin.name}</div>
                <div className={`mt-0.5 truncate text-[11px] ${skin.source === "official" ? "text-cyan-300" : "text-slate-500"}`}>
                  {skin.source === "official" ? "Official current design" : activeHero.heroName}
                </div>
              </figcaption>
            </figure>)}
          </div>
        </> : <div className="grid min-h-80 place-items-center border border-dashed border-white/10 text-center text-slate-400">
          <div>
            <Images className="mx-auto mb-3 h-9 w-9 text-slate-500" />
            <p>{manifestQ.isLoading ? "Loading skin index..." : "Refresh to build the wiki skin index."}</p>
          </div>
        </div>}
      </section>
    </div>
    <p className="mt-5 text-xs text-slate-500">{manifest?.provenance ?? "Official current hero designs with supplemental community-maintained skin catalogue."}</p>
  </div>;
}
