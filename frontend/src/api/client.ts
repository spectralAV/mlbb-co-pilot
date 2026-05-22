const API = "";
export async function apiGet<T>(path:string):Promise<T>{ const res=await fetch(`${API}${path}`); if(!res.ok) throw new Error(`${path} failed`); return res.json() as Promise<T>; }
export async function apiPost<T>(path:string, body:unknown={}):Promise<T>{ const res=await fetch(`${API}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); if(!res.ok) throw new Error(`${path} failed`); return res.json() as Promise<T>; }
export const API_BASE = API;
export const syncOfficialData = (authorization: string) => apiPost<any>("/api/sync/official", { authorization });
export const getRuntimeStatus = () => apiGet<any>("/api/runtime/status");
export const getRuntime = () => apiGet<any>("/api/runtime");
export const getRuntimeHeroes = () => apiGet<any>("/api/runtime/heroes");
export const getHeroBuild = (heroName: string) => apiGet<any>(`/api/builds/hero/${encodeURIComponent(heroName)}`);
export const getCoachState = () => apiGet<any>("/api/coach/state");
export const updateCoachState = (state: unknown) => apiPost<any>("/api/coach/state", state);
export const getObsRegions = () => apiGet<any>("/api/obs/regions");
export const saveObsRegions = (regions: unknown) => apiPost<any>("/api/obs/regions", regions);
export const addObsRegion = (key: string, region: number[]) => apiPost<any>("/api/obs/regions/add", { key, region });
export const clearObsRegions = (key: string) => apiPost<any>("/api/obs/regions/clear", { key });
export const getObsConfig = () => apiGet<any>("/api/obs/config");
export const saveObsConfig = (config: unknown) => apiPost<any>("/api/obs/config", config);
export const getMapZones = () => apiGet<any>("/api/map/zones");
export const saveMapZones = (zones: unknown) => apiPost<any>("/api/map/zones", { zones });
export async function applyPatchZip(file: File) {
  const body = new FormData();
  body.append("patch", file);
  const res = await fetch(`${API}/api/updates/apply`, { method: "POST", body });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Patch upload failed: ${res.status}`);
  return json;
}
