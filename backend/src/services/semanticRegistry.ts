import { cache } from "./cacheService.js";
const mlbbImage = (p: string, w = 64) => `https://mlbb.io/_next/image?url=${encodeURIComponent(p)}&w=${w}&q=75`;
export const iconUrl = {
  item: (imagePath?: string) => imagePath ? mlbbImage(imagePath) : "",
  emblem: (img?: string) => img ? mlbbImage(`/images/emblems/${img}`) : "",
  talent: (img?: string) => img ? mlbbImage(`/images/emblems/abilities/${img}`) : ""
};
export const semanticRegistry = {
  async overview() {
    const [heroes,items,emblems,talents,compiledItems,compiledHeroes] = await Promise.all([
      cache.read<any[]>("heroes.json", []), cache.read<any[]>("items.json", []), cache.read<any[]>("emblems.json", []), cache.read<any[]>("talents.json", []), cache.read<any[]>("compiled-items.json", []), cache.read<any[]>("compiled-heroes.json", [])
    ]);
    return { heroes:heroes.length, items:items.length, emblems:emblems.length, talents:talents.length, compiledItems:compiledItems.length, compiledHeroes:compiledHeroes.length };
  },
  async resolveItem(id:number){ const items=await cache.read<any[]>("items.json",[]); const i=items.find(x=>Number(x.id)===Number(id)); return i ? {...i, icon_url: iconUrl.item(i.image_path)} : {id, name:`Item ${id}`}; },
  async resolveEmblem(id:number){ const data=await cache.read<any[]>("emblems.json",[]); const e=data.find(x=>Number(x.id)===Number(id)); return e ? {...e, icon_url: iconUrl.emblem(e.img_src)} : {id, name:`Emblem ${id}`}; },
  async resolveTalent(id:number){ const data=await cache.read<any[]>("talents.json",[]); const t=data.find(x=>Number(x.id)===Number(id)); return t ? {...t, icon_url: iconUrl.talent(t.img_src)} : {id, name:`Talent ${id}`}; }
};
