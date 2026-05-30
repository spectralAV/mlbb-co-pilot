import { API_BASE, apiUrl, apiWsUrl } from "./transport";

async function responseError(res: Response, path: string) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return new Error(json.error ?? json.message ?? `${path} failed (${res.status})`);
  } catch {
    return new Error(text || `${path} failed (${res.status})`);
  }
}
export async function apiGet<T>(path:string):Promise<T>{ const res=await fetch(apiUrl(path), { cache: "no-store" }); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
export async function apiPost<T>(path:string, body:unknown={}):Promise<T>{ const res=await fetch(apiUrl(path),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
export async function apiDelete<T>(path:string):Promise<T>{ const res=await fetch(apiUrl(path),{method:"DELETE"}); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
function bearer(token: string) { return token.startsWith("Bearer ") ? token : `Bearer ${token}`; }
function queryString(params: Record<string, unknown> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}
function ronePath(path: string) {
  return path.replace(/^\/?api\//, "").replace(/^\/+/, "");
}
export async function apiGetAuth<T>(path:string, token:string):Promise<T>{ const res=await fetch(apiUrl(path), { cache: "no-store", headers: { authorization: bearer(token) } }); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
export async function apiPostAuth<T>(path:string, token:string, body:unknown={}):Promise<T>{ const res=await fetch(apiUrl(path),{method:"POST",headers:{"content-type":"application/json",authorization:bearer(token)},body:JSON.stringify(body)}); if(!res.ok) throw await responseError(res, path); return res.json() as Promise<T>; }
export { API_BASE, apiUrl, apiWsUrl };
export const syncOfficialData = (authorization: string) => apiPost<any>("/api/sync/official", { authorization });
export const getRoneStatus = () => apiGet<any>("/api/rone/status");
export const getRoneSnapshot = () => apiGet<any>("/api/rone/snapshot");
export const saveRoneSnapshot = (body: unknown) => apiPost<any>("/api/rone/snapshot", body);
export const deleteRoneSnapshot = () => apiDelete<any>("/api/rone/snapshot");
export const getRonePublic = (path: string, params: Record<string, unknown> = {}) => apiGet<any>(`/api/rone/public/${ronePath(path)}${queryString(params)}`);
export const sendRoneVerificationCode = (roleId: number, zoneId: number) => apiPost<any>("/api/rone/user/auth/send-vc", { role_id: roleId, zone_id: zoneId });
export const loginRoneUser = (roleId: number, zoneId: number, vc: number) => apiPost<any>("/api/rone/user/auth/login", { role_id: roleId, zone_id: zoneId, vc });
export const getRoneUser = (path: string, token: string, params: Record<string, unknown> = {}) => apiGetAuth<any>(`/api/rone/user/${ronePath(path).replace(/^user\//, "")}${queryString(params)}`, token);
export const postRoneUser = (path: string, token: string, body: unknown = {}, params: Record<string, unknown> = {}) => apiPostAuth<any>(`/api/rone/user/${ronePath(path).replace(/^user\//, "")}${queryString(params)}`, token, body);
export const getAdbAssetStatus = () => apiGet<any>("/api/sync/adb-assets/status");
export const syncAdbAssets = (scope: "draft" | "vision" | "ui" = "draft") => apiPost<any>("/api/sync/adb-assets", { scope });
export const getRuntimeStatus = () => apiGet<any>("/api/runtime/status");
export const getPerformanceSnapshot = () => apiGet<any>("/api/performance/snapshot");
export const postClientPerformanceSample = (sample: unknown) => apiPost<any>("/api/performance/client", sample);
export const getRuntime = () => apiGet<any>("/api/runtime");
export const getRuntimeHeroes = () => apiGet<any>("/api/runtime/heroes");
export const getHeroBuild = (heroName: string) => apiGet<any>(`/api/builds/hero/${encodeURIComponent(heroName)}`);
export const getCoachState = () => apiGet<any>("/api/coach/state");
export const updateCoachState = (state: unknown) => apiPost<any>("/api/coach/state", state);
export const getOverlayState = () => apiGet<any>("/api/overlay/state");
export const updateOverlayState = (state: unknown) => apiPost<any>("/api/overlay/state", state);
export const getOverlayMediaConfig = () => apiGet<any>("/api/overlay/media/config");
export const updateOverlayMediaConfig = (config: unknown) => apiPost<any>("/api/overlay/media/config", config);
export async function uploadOverlayMedia(slot: "logo" | "sponsor", file: File) {
  const body = new FormData();
  body.append("media", file);
  const res = await fetch(apiUrl(`/api/overlay/media/${slot}`), { method: "POST", body });
  if (!res.ok) throw await responseError(res, `/api/overlay/media/${slot}`);
  return res.json() as Promise<any>;
}
export async function deleteOverlayMedia(slot: "logo" | "sponsor") {
  const res = await fetch(apiUrl(`/api/overlay/media/${slot}`), { method: "DELETE" });
  if (!res.ok) throw await responseError(res, `/api/overlay/media/${slot}`);
  return res.json() as Promise<any>;
}
export const getObsRegions = () => apiGet<any>("/api/obs/regions");
export const saveObsRegions = (regions: unknown) => apiPost<any>("/api/obs/regions", regions);
export const addObsRegion = (key: string, region: number[]) => apiPost<any>("/api/obs/regions/add", { key, region });
export const clearObsRegions = (key: string) => apiPost<any>("/api/obs/regions/clear", { key });
export const getObsConfig = () => apiGet<any>("/api/obs/config");
export const saveObsConfig = (config: unknown) => apiPost<any>("/api/obs/config", config);
export const getNativeObsVisionStatus = () => apiGet<any>("/api/capture/obs/status");
export const getNdiToolsStatus = () => apiGet<any>("/api/capture/ndi/status");
export const getNdiDirectStatus = () => apiGet<any>("/api/capture/ndi/direct/status");
export const getNdiDirectSources = () => apiGet<any>("/api/capture/ndi/direct/sources");
export const startNdiDirectCapture = (sourceName: string, sourceUrl?: string, maxFps = 30) => apiPost<any>("/api/capture/ndi/direct/start", { sourceName, sourceUrl, maxFps });
export const stopNdiDirectCapture = () => apiPost<any>("/api/capture/ndi/direct/stop");
export const launchNdiTool = (tool: "studioMonitor" | "testPatterns" | "screenCapture" | "webcam" | "accessManager" | "launcher" = "studioMonitor") => apiPost<any>("/api/capture/ndi/launch", { tool });
export const getMapZones = () => apiGet<any>("/api/map/zones");
export const saveMapZones = (zones: unknown) => apiPost<any>("/api/map/zones", { zones });
export const getMapProjection = () => apiGet<any>("/api/map/projection");
export const saveMapProjection = (projection: unknown) => apiPost<any>("/api/map/projection", { projection });
export const projectMinimapPoint = (x: number, y: number) => apiPost<any>("/api/map/project-minimap-point", { x, y });
export const getHeroRecognitionManifest = () => apiGet<any>("/api/vision/heroes/manifest");
export const getSkinPortraitManifest = () => apiGet<any>("/api/vision/skins/manifest");
export const syncSkinPortraitManifest = () => apiPost<any>("/api/vision/skins/sync");
export const getSkinSignatureManifest = () => apiGet<any>("/api/vision/skins/signatures");
export const getSkinSignatureStatus = () => apiGet<any>("/api/vision/skins/signatures/status");
export const compileSkinPortraitSignatures = () => apiPost<any>("/api/vision/skins/signatures/compile");
export const getLaneRecognitionManifest = () => apiGet<any>("/api/vision/lanes/manifest");
export const getLatestDraftRecognition = () => apiGet<any>("/api/vision/draft/latest");
export const ingestDraftRecognition = (state: unknown) => apiPost<any>("/api/vision/draft/recognition", state);
export const getLatestLiveVision = () => apiGet<any>("/api/vision/live/latest");
export const ingestLiveVisionFrame = (state: unknown) => apiPost<any>("/api/vision/live/frame", state);
export const getScreenStateModel = () => apiGet<any>("/api/vision/models/screen-state");
export const getScreenStateTrainingStatus = () => apiGet<any>("/api/vision/models/screen-state/status");
export const trainScreenStateModel = () => apiPost<any>("/api/vision/models/screen-state/train");
export const getDraftHeroModel = () => apiGet<any>("/api/vision/models/draft-heroes");
export const getDraftHeroModelStatus = () => apiGet<any>("/api/vision/models/draft-heroes/status");
export const trainDraftHeroModel = () => apiPost<any>("/api/vision/models/draft-heroes/train");
export const getUltralyticsStatus = () => apiGet<any>("/api/vision/models/ultralytics/status");
export const installUltralyticsRuntime = () => apiPost<any>("/api/vision/models/ultralytics/install");
export const trainUltralyticsModel = (options: unknown = {}) => apiPost<any>("/api/vision/models/ultralytics/train", options);
export const getDinoIdentityStatus = () => apiGet<any>("/api/vision/models/dino/status");
export const indexDinoReferences = () => apiPost<any>("/api/vision/models/dino/index");
export async function matchDinoIdentity(crop: Blob, options: unknown = {}) {
  const body = new FormData();
  body.append("options", JSON.stringify(options));
  body.append("crop", crop, "hero-crop.png");
  const response = await fetch(apiUrl("/api/vision/models/dino/match"), { method: "POST", body });
  if (!response.ok) throw await responseError(response, "/api/vision/models/dino/match");
  return response.json() as Promise<any>;
}
export const getTimerOcrStatus = () => apiGet<any>("/api/vision/models/timer-ocr/status");
export const installTimerOcrRuntime = () => apiPost<any>("/api/vision/models/timer-ocr/install");
export async function inferTimerCrop(crop: Blob, timerType: string) {
  const body = new FormData();
  body.append("timerType", timerType);
  body.append("crop", crop, "timer-crop.png");
  const response = await fetch(apiUrl("/api/vision/models/timer-ocr/infer"), { method: "POST", body });
  if (!response.ok) throw await responseError(response, "/api/vision/models/timer-ocr/infer");
  return response.json() as Promise<any>;
}
export const getScreenOcrStatus = () => apiGet<any>("/api/vision/models/screen-ocr/status");
export const installScreenOcrRuntime = () => apiPost<any>("/api/vision/models/screen-ocr/install");
export async function inferScreenOcrFrame(frame: Blob, options: unknown = {}) {
  const body = new FormData();
  body.append("options", JSON.stringify(options));
  body.append("frame", frame, "screen-frame.png");
  const response = await fetch(apiUrl("/api/vision/models/screen-ocr/infer"), { method: "POST", body });
  if (!response.ok) throw await responseError(response, "/api/vision/models/screen-ocr/infer");
  return response.json() as Promise<any>;
}
export const getCvAnnotationClasses = () => apiGet<any>("/api/vision/annotations/classes");
export const getCvAnnotations = () => apiGet<any>("/api/vision/annotations");
export const syncCvAnnotations = () => apiPost<any>("/api/vision/annotations/sync");
export async function deleteCvAnnotation(id: string) {
  const response = await fetch(apiUrl(`/api/vision/annotations/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) throw await responseError(response, "/api/vision/annotations");
  return response.json() as Promise<any>;
}
export async function saveCvAnnotation(frame: Blob, metadata: unknown) {
  const body = new FormData();
  body.append("metadata", JSON.stringify(metadata));
  body.append("frame", frame, "annotation-frame.png");
  const response = await fetch(apiUrl("/api/vision/annotations"), { method: "POST", body });
  if (!response.ok) throw await responseError(response, "/api/vision/annotations");
  return response.json() as Promise<any>;
}
export async function inferUltralyticsFrame(frame: Blob, confidence = 0.55) {
  const body = new FormData();
  body.append("confidence", String(confidence));
  body.append("frame", frame, "frame.jpg");
  const response = await fetch(apiUrl("/api/vision/models/ultralytics/infer"), { method: "POST", body });
  if (!response.ok) throw await responseError(response, "/api/vision/models/ultralytics/infer");
  return response.json() as Promise<any>;
}
export const getLatestLiveReasoning = () => apiGet<any>("/api/reasoning/live/latest");
export const evaluateLiveReasoning = (state: unknown) => apiPost<any>("/api/reasoning/live/evaluate", state);
export const getLiveReasoningScenarios = () => apiGet<any>("/api/reasoning/live/scenarios");
export const getMatchState = () => apiGet<any>("/api/match/state");
export const getPlayerProfile = () => apiGet<any>("/api/profile");
export const savePlayerProfile = (profile: unknown) => apiPost<any>("/api/profile", profile);
export const getBattleSpellRecognitionManifest = () => apiGet<any>("/api/vision/spells/manifest");
export const getEquipmentRecognitionManifest = () => apiGet<any>("/api/vision/equipment/manifest");
export const getScrcpyStatus = () => apiGet<any>("/api/capture/scrcpy/status");
export const startScrcpy = (options: unknown = {}) => apiPost<any>("/api/capture/scrcpy/start", options);
export const stopScrcpy = () => apiPost<any>("/api/capture/scrcpy/stop");
export async function applyPatchZip(file: File) {
  const body = new FormData();
  body.append("patch", file);
  const res = await fetch(apiUrl("/api/updates/apply"), { method: "POST", body });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `Patch upload failed: ${res.status}`);
  return json;
}
