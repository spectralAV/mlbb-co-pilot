const API = "";
async function responseError(res: Response, path: string) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return new Error(json.error ?? json.message ?? `${path} failed (${res.status})`);
  } catch {
    return new Error(text || `${path} failed (${res.status})`);
  }
}
export async function apiGet<T>(path:string):Promise<T>{ const res=await fetch(`${API}${path}`); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
export async function apiPost<T>(path:string, body:unknown={}):Promise<T>{ const res=await fetch(`${API}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
export const API_BASE = API;
export const syncOfficialData = (authorization: string) => apiPost<any>("/api/sync/official", { authorization });
export const getRuntimeStatus = () => apiGet<any>("/api/runtime/status");
export const getRuntime = () => apiGet<any>("/api/runtime");
export const getRuntimeHeroes = () => apiGet<any>("/api/runtime/heroes");
export const getHeroBuild = (heroName: string) => apiGet<any>(`/api/builds/hero/${encodeURIComponent(heroName)}`);
export const getCoachState = () => apiGet<any>("/api/coach/state");
export const updateCoachState = (state: unknown) => apiPost<any>("/api/coach/state", state);
export const getOverlayState = () => apiGet<any>("/api/overlay/state");
export const updateOverlayState = (state: unknown) => apiPost<any>("/api/overlay/state", state);
export const getObsRegions = () => apiGet<any>("/api/obs/regions");
export const saveObsRegions = (regions: unknown) => apiPost<any>("/api/obs/regions", regions);
export const addObsRegion = (key: string, region: number[]) => apiPost<any>("/api/obs/regions/add", { key, region });
export const clearObsRegions = (key: string) => apiPost<any>("/api/obs/regions/clear", { key });
export const getObsConfig = () => apiGet<any>("/api/obs/config");
export const saveObsConfig = (config: unknown) => apiPost<any>("/api/obs/config", config);
export const getMapZones = () => apiGet<any>("/api/map/zones");
export const saveMapZones = (zones: unknown) => apiPost<any>("/api/map/zones", { zones });
export const getMapProjection = () => apiGet<any>("/api/map/projection");
export const saveMapProjection = (projection: unknown) => apiPost<any>("/api/map/projection", { projection });
export const projectMinimapPoint = (x: number, y: number) => apiPost<any>("/api/map/project-minimap-point", { x, y });
export const getHeroRecognitionManifest = () => apiGet<any>("/api/vision/heroes/manifest");
export const getLatestDraftRecognition = () => apiGet<any>("/api/vision/draft/latest");
export const ingestDraftRecognition = (state: unknown) => apiPost<any>("/api/vision/draft/recognition", state);
export const getLatestLiveVision = () => apiGet<any>("/api/vision/live/latest");
export const ingestLiveVisionFrame = (state: unknown) => apiPost<any>("/api/vision/live/frame", state);
export const getLatestLiveReasoning = () => apiGet<any>("/api/reasoning/live/latest");
export const evaluateLiveReasoning = (state: unknown) => apiPost<any>("/api/reasoning/live/evaluate", state);
export const getMatchState = () => apiGet<any>("/api/match/state");
export const getScrcpyStatus = () => apiGet<any>("/api/capture/scrcpy/status");
export const startScrcpy = (options: unknown = {}) => apiPost<any>("/api/capture/scrcpy/start", options);
export const stopScrcpy = () => apiPost<any>("/api/capture/scrcpy/stop");
export async function applyPatchZip(file: File) {
  const body = new FormData();
  body.append("patch", file);
  const res = await fetch(`${API}/api/updates/apply`, { method: "POST", body });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Patch upload failed: ${res.status}`);
  return json;
}
