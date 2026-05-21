import { GmsClient } from './GmsClient.js';
import { fetchHeroDirectory } from './HeroDirectoryProvider.js';
import { fetchHeroMeta } from './HeroMetaProvider.js';
import { fetchPatchArticles } from './PatchProvider.js';
import { compileRuntime } from '../../runtime/compileRuntime.js';
import { saveRaw, saveRuntime } from '../../runtime/RuntimeStore.js';

export async function syncOfficialData(options: { authorization: string; lang?: string; rank?: string; matchType?: number }) {
  const client = new GmsClient(options.authorization, options.lang ?? 'en');

  const [directory, meta, patches] = await Promise.all([
    fetchHeroDirectory(client),
    fetchHeroMeta(client, options.rank ?? '101', options.matchType ?? 0),
    fetchPatchArticles(client).catch((error) => ({ error: String(error) }))
  ]);

  const runtime = compileRuntime(directory, meta);

  await saveRaw('heroes-official.raw.json', directory);
  await saveRaw('meta-official.raw.json', meta);
  await saveRaw('patches-official.raw.json', patches);
  await saveRuntime(runtime);

  return {
    ok: true,
    synced: {
      heroDirectory: Boolean(directory),
      heroMeta: Boolean(meta),
      patchArticles: !("error" in (patches as any))
    },
    runtime: {
      heroes: runtime.heroes.length,
      updatedAt: runtime.generatedAt
    },
    generatedAt: runtime.generatedAt,
    heroes: runtime.heroes.length,
    sources: runtime.sources
  };
}
