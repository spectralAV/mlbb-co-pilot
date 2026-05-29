import { create } from "zustand";
import { getScreenStateModel, getUltralyticsStatus, inferUltralyticsFrame, ingestLiveVisionFrame, startScrcpy, stopScrcpy } from "../api/client";
import { detectDraftVisualContext } from "../vision/draftContextDetector";
import { queueDraftBanIconRecognition } from "../vision/draftIconDetector";
import { detectMinimapMarkerCandidatesFromRgba } from "../vision/minimapMarkerDetector";
import { detectEquipmentItems, type DetectedEquipmentItem } from "../vision/equipmentDetector";
import { classifyWithTrainedScreenStateModel, type TrainedScreenStateModel } from "../vision/trainedScreenStateModel";
import { calibratedRect, calibratedRectForKeys, ensureActiveCalibrationRegions } from "../vision/calibrationRegions";

export type RegionKey = "equipment_window" | "attributes_window" | "scoreboard" | "minimap";
export type Region = { key: RegionKey; label: string; rect: [number, number, number, number] };
export type RegionMetrics = { mean: number; contrast: number; changed: number; active: boolean };
export type CaptureSource = "adb" | "window" | "scrcpy" | "ndi" | "capture_card" | "obs";
export type SourceMode = "idle" | "browser" | "adb" | "scrcpy" | "obs" | "recording";
export type ScrcpyVideoCodec = "h264" | "h265" | "av1";
export type CaptureLogEntry = { time: number; level: "info" | "warn" | "error"; message: string };
export type WindowContentCrop = { enabled: boolean; top: number; right: number; bottom: number; left: number };
type NativeCrop = { time: number; key: RegionKey; width: number; height: number; bitmap: ImageBitmap };
type FrameSummary = { time: number; sourceWidth: number; sourceHeight: number; regions: Record<RegionKey, RegionMetrics> };
type ScrcpyFrameMeta = { type: "scrcpy_frame"; config?: boolean; key?: boolean; ptsUs?: number; size?: number };
type PixelRegion = { x: number; y: number; w: number; h: number };
type VisionProbe = { key: string; rect: [number, number, number, number] };
type UltralyticsDetection = {
  classId: number;
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  center: [number, number];
  source: "ultralytics-yolo";
  trackId?: string;
  trackAge?: number;
  trackMissingFrames?: number;
};
type MinimapObjectDetection = {
  id: string;
  objectType: "turtle" | "lord" | "ally_turret" | "enemy_turret";
  minimap: [number, number];
  confidence: number;
  source: "ultralytics-yolo";
};
type ScreenTextFact = {
  region: string;
  text: string;
  confidence: number;
  rect: [number, number, number, number];
  words?: Array<{ text: string; confidence: number }>;
  source: "paddleocr-screen";
  observedAt: number;
};
export type MinimapMarkerDetection = {
  id: string;
  side: "ally" | "enemy";
  markerClass: "team-color-candidate";
  minimap: [number, number];
  confidence: number;
  sampledAt: number;
};
export type VisionScreenState = "unknown" | "lobby" | "draft" | "loading" | "live_hud" | "death_replay" | "scoreboard" | "item_shop";
export type LiveVisionFrame = {
  screen: VisionScreenState;
  confidence: number;
  evidence: string[];
  directorScene?: "main" | "map" | "text" | "counter" | "picks";
  timestamp: number;
  source?: string;
  signals?: {
    enemyItems?: string[];
    enemyEquipment?: DetectedEquipmentItem[];
    allyItems?: string[];
    allyEquipment?: DetectedEquipmentItem[];
    yoloDetections?: UltralyticsDetection[];
    minimapObjects?: MinimapObjectDetection[];
    screenTextFacts?: ScreenTextFact[];
  };
};
export type VisionStabilityState = {
  confirmed: LiveVisionFrame | null;
  candidate: LiveVisionFrame | null;
  candidateFrames: number;
};

const scoreboardBodyRect: [number, number, number, number] = [0.1, 0.13, 0.8, 0.78];
const defaultWindowContentCrop: WindowContentCrop = { enabled: false, top: 0.13, right: 0, bottom: 0.06, left: 0 };
const windowContentCropStorageKey = "mlbb.capture.windowContentCrop.v1";

const defaultRegions: Region[] = [
  { key: "equipment_window", label: "Equipment Window", rect: scoreboardBodyRect },
  { key: "attributes_window", label: "Attributes Window", rect: scoreboardBodyRect },
  { key: "scoreboard", label: "Top HUD", rect: [0.32, 0, 0.36, 0.08] },
  { key: "minimap", label: "Minimap", rect: [0.02521, 0, 0.146359, 0.326563] }
];

export const regions: Region[] = defaultRegions.map((region) => ({ ...region }));

const defaultVisionProbes: VisionProbe[] = [
  { key: "top_hud", rect: [0.28, 0, 0.45, 0.08] },
  { key: "draft_left_rail", rect: [0, 0.08, 0.22, 0.84] },
  { key: "draft_right_rail", rect: [0.78, 0.08, 0.22, 0.84] },
  { key: "center_panel", rect: [0.27, 0.1, 0.48, 0.64] },
  { key: "modal_body", rect: [0.1, 0.13, 0.8, 0.78] }
];

function calibratedRuntimeRegions() {
  const resolved = defaultRegions.map((region) => ({
    ...region,
    rect: calibratedRect(`${region.key}_norm`, region.rect),
  }));
  for (const [index, region] of resolved.entries()) regions[index].rect = region.rect;
  return resolved;
}

function calibratedVisionProbes() {
  return defaultVisionProbes.map((probe) => {
    if (probe.key === "top_hud") return { ...probe, rect: calibratedRect("scoreboard_norm", probe.rect) };
    if (probe.key === "draft_left_rail") return { ...probe, rect: calibratedRectForKeys(["ally_picks_norm", "ally_pick_portraits_norm"], probe.rect) };
    if (probe.key === "draft_right_rail") return { ...probe, rect: calibratedRectForKeys(["enemy_picks_norm", "enemy_pick_portraits_norm"], probe.rect) };
    if (probe.key === "modal_body") return { ...probe, rect: calibratedRectForKeys(["equipment_window_norm", "attributes_window_norm"], probe.rect) };
    return probe;
  });
}

export const maxBufferedFrames = 60;
export const maxNativeCrops = 96;
const scrcpyMaxFps = 15;
const h264MaxDecodeQueue = 6;

export const captureSources: Array<{
  id: CaptureSource;
  title: string;
  state: "ready" | "permission" | "planned" | "optional";
  detail: string;
}> = [
  { id: "adb", title: "ADB Phone", state: "ready", detail: "Native pixels, works in this browser, slower frame rate." },
  { id: "scrcpy", title: "Backend scrcpy", state: "ready", detail: "Direct H.264 stream decoded with WebCodecs for realtime preview and CV." },
  { id: "ndi", title: "NDI Stream", state: "planned", detail: "iPhone/iPad friendly network video source for backend decoding." },
  { id: "capture_card", title: "Capture Card", state: "planned", detail: "HDMI/USB video input for phones, tablets, or external devices." },
  { id: "window", title: "Window Share", state: "permission", detail: "Fast when browser screen-share permission is available." },
  { id: "obs", title: "Native OBS Bridge", state: "ready", detail: "Frames from the native scrcpy OBS source feed the same live CV and reasoning pipeline." }
];

export function emptyMetrics(): Record<RegionKey, RegionMetrics> {
  return {
    equipment_window: { mean: 0, contrast: 0, changed: 0, active: false },
    attributes_window: { mean: 0, contrast: 0, changed: 0, active: false },
    scoreboard: { mean: 0, contrast: 0, changed: 0, active: false },
    minimap: { mean: 0, contrast: 0, changed: 0, active: false }
  };
}

export function createVisionStabilityState(): VisionStabilityState {
  return { confirmed: null, candidate: null, candidateFrames: 0 };
}

export function resolveWindowContentCrop(width: number, height: number, crop: WindowContentCrop) {
  if (!crop.enabled) return { x: 0, y: 0, width, height };
  const left = Math.round(width * Math.max(0, Math.min(0.4, crop.left)));
  const right = Math.round(width * Math.max(0, Math.min(0.4, crop.right)));
  const top = Math.round(height * Math.max(0, Math.min(0.4, crop.top)));
  const bottom = Math.round(height * Math.max(0, Math.min(0.4, crop.bottom)));
  return {
    x: left,
    y: top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
}

function loadWindowContentCrop(): WindowContentCrop {
  if (typeof window === "undefined") return defaultWindowContentCrop;
  try {
    const saved = JSON.parse(window.localStorage.getItem(windowContentCropStorageKey) ?? "{}");
    return { ...defaultWindowContentCrop, ...saved };
  } catch {
    return defaultWindowContentCrop;
  }
}

type CaptureRuntimeState = {
  running: boolean;
  sourceMode: SourceMode;
  selectedSource: CaptureSource;
  selectedCodec: ScrcpyVideoCodec;
  fps: number;
  buffered: number;
  nativeCrops: number;
  sourceSize: { width: number; height: number };
  lastFrameAge: number | null;
  metrics: Record<RegionKey, RegionMetrics>;
  minimapDetections: MinimapMarkerDetection[];
  liveVision: LiveVisionFrame | null;
  captureLog: CaptureLogEntry[];
  error: string;
  adbPreviewUrl: string;
  stream: MediaStream | null;
  windowContentCrop: WindowContentCrop;
  setSelectedSource: (source: CaptureSource) => void;
  setSelectedCodec: (codec: ScrcpyVideoCodec) => void;
  setWindowContentCrop: (next: Partial<WindowContentCrop>) => void;
};

export const useCaptureRuntimeStore = create<CaptureRuntimeState>((set) => ({
  running: false,
  sourceMode: "idle",
  selectedSource: "adb",
  selectedCodec: "h264",
  fps: 0,
  buffered: 0,
  nativeCrops: 0,
  sourceSize: { width: 0, height: 0 },
  lastFrameAge: null,
  metrics: emptyMetrics(),
  minimapDetections: [],
  liveVision: null,
  captureLog: [],
  error: "",
  adbPreviewUrl: "",
  stream: null,
  windowContentCrop: loadWindowContentCrop(),
  setSelectedSource: (selectedSource) => set({ selectedSource }),
  setSelectedCodec: (selectedCodec) => set({ selectedCodec }),
  setWindowContentCrop: (next) => set((state) => {
    const windowContentCrop = { ...state.windowContentCrop, ...next };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(windowContentCropStorageKey, JSON.stringify(windowContentCrop));
    }
    return { windowContentCrop };
  })
}));

function addCaptureLog(level: CaptureLogEntry["level"], message: string) {
  useCaptureRuntimeStore.setState((state) => ({
    captureLog: [...state.captureLog, { time: Date.now(), level, message }].slice(-24)
  }));
}

const runtime = {
  video: null as HTMLVideoElement | null,
  canvas: null as HTMLCanvasElement | null,
  previewCanvas: null as HTMLCanvasElement | null,
  adbPreviewUrl: "",
  adbTimer: null as number | null,
  adbActive: false,
  obsBridgeActive: false,
  lastObsFrameAt: "",
  h264Socket: null as WebSocket | null,
  h264Decoder: null as any,
  h264Configured: false,
  h264ReadyForKey: true,
  h264ConfigPayload: null as Uint8Array | null,
  h264PendingMeta: [] as ScrcpyFrameMeta[],
  h264RawBuffer: new Uint8Array(0),
  h264AuNals: [] as Uint8Array[],
  h264AuHasVcl: false,
  h264AuKey: false,
  h264ParameterSets: [] as Uint8Array[],
  h264CodecString: "",
  videoCodec: "h264" as ScrcpyVideoCodec,
  stream: null as MediaStream | null,
  frameBuffer: [] as FrameSummary[],
  nativeCropBuffer: [] as NativeCrop[],
  previous: emptyMetrics(),
  frameTimes: [] as number[],
  lastFrameAt: 0,
  lastVisionPostedAt: 0,
  visionPostInFlight: false,
  visionStability: createVisionStabilityState(),
  trainedScreenModel: null as TrainedScreenStateModel | null,
  trainedScreenModelLoading: false,
  ultralyticsReady: false,
  ultralyticsStatusLoading: false,
  ultralyticsFrameInFlight: false,
  lastUltralyticsAt: 0,
  lastUltralyticsStatusAt: 0,
  raf: null as number | null,
  ageTimer: null as number | null
};

export function attachCaptureRuntime(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null) {
  runtime.video = video;
  runtime.canvas = canvas;
  if (video && canvas) {
    void ensureActiveCalibrationRegions().then(() => {
      calibratedRuntimeRegions();
    });
    void loadTrainedScreenModel();
    void loadUltralyticsStatus();
  }
  if (video && runtime.stream) {
    video.srcObject = runtime.stream;
    void video.play().catch(() => {});
  }
}

async function loadUltralyticsStatus() {
  if (runtime.ultralyticsStatusLoading || runtime.ultralyticsReady) return;
  runtime.ultralyticsStatusLoading = true;
  runtime.lastUltralyticsStatusAt = performance.now();
  try {
    const response = await getUltralyticsStatus();
    runtime.ultralyticsReady = Boolean(response.data?.packageAvailable && response.data?.modelAvailable);
  } catch {
    runtime.ultralyticsReady = false;
  } finally {
    runtime.ultralyticsStatusLoading = false;
  }
}

async function loadTrainedScreenModel() {
  if (runtime.trainedScreenModel || runtime.trainedScreenModelLoading) return;
  runtime.trainedScreenModelLoading = true;
  try {
    const response = await getScreenStateModel();
    const model = response.data as TrainedScreenStateModel | null;
    if (model?.validation?.accuracy >= 0.7) runtime.trainedScreenModel = model;
  } catch {
    // Runtime keeps its conservative visual rules when no trained model is available.
  } finally {
    runtime.trainedScreenModelLoading = false;
  }
}

export async function captureCurrentRuntimeFrame(): Promise<{ blob: Blob; width: number; height: number; mode: SourceMode; source: CaptureSource } | null> {
  const canvas = runtime.canvas;
  const state = useCaptureRuntimeStore.getState();
  if (!canvas || !canvas.width || !canvas.height || state.sourceMode === "idle") return null;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    mode: state.sourceMode,
    source: state.selectedSource
  };
}

export async function analyzeCapturedFrameBlob(blob: Blob, source: SourceMode = "recording") {
  const bitmap = await createImageBitmap(blob);
  const canvas = runtime.canvas ?? document.createElement("canvas");
  const width = bitmap.width;
  const height = bitmap.height;
  canvas.width = width;
  canvas.height = height;
  updateSourceSize(width, height);
  canvas.getContext("2d", { willReadFrequently: true })?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, vision: analyzeCanvas(canvas, width, height, source) };
}

export function attachCapturePreviewCanvas(canvas: HTMLCanvasElement | null) {
  runtime.previewCanvas = canvas;
}

export function stopCaptureRuntime() {
  addCaptureLog("info", "Stopping capture runtime.");
  if (runtime.raf != null) cancelAnimationFrame(runtime.raf);
  if (runtime.adbTimer != null) window.clearTimeout(runtime.adbTimer);
  if (runtime.ageTimer != null) window.clearInterval(runtime.ageTimer);
  runtime.h264Socket?.close();
  runtime.h264Decoder?.close?.();
  runtime.raf = null;
  runtime.adbTimer = null;
  runtime.ageTimer = null;
  runtime.h264Socket = null;
  runtime.h264Decoder = null;
  runtime.h264Configured = false;
  runtime.h264ReadyForKey = true;
  runtime.h264ConfigPayload = null;
  runtime.h264PendingMeta = [];
  runtime.h264RawBuffer = new Uint8Array(0);
  runtime.h264AuNals = [];
  runtime.h264AuHasVcl = false;
  runtime.h264AuKey = false;
  runtime.h264ParameterSets = [];
  runtime.h264CodecString = "";
  runtime.adbActive = false;
  runtime.obsBridgeActive = false;
  runtime.lastObsFrameAt = "";
  runtime.stream?.getTracks().forEach((track) => track.stop());
  runtime.stream = null;
  if (runtime.video) runtime.video.srcObject = null;
  if (runtime.adbPreviewUrl) URL.revokeObjectURL(runtime.adbPreviewUrl);
  runtime.adbPreviewUrl = "";
  runtime.lastFrameAt = 0;
  runtime.visionStability = createVisionStabilityState();
  runtime.nativeCropBuffer.splice(0).forEach((crop) => crop.bitmap.close());
  const mode = useCaptureRuntimeStore.getState().sourceMode;
  if (mode === "scrcpy") void stopScrcpy().catch(() => {});
  useCaptureRuntimeStore.setState({ running: false, sourceMode: "idle", stream: null, adbPreviewUrl: "", nativeCrops: 0, fps: 0, lastFrameAge: null, minimapDetections: [], liveVision: null });
}

export function startSelectedCaptureRuntime() {
  const selected = useCaptureRuntimeStore.getState().selectedSource;
  addCaptureLog("info", `Starting ${selected} capture.`);
  if (selected === "adb") return void startAdbCapture();
  if (selected === "window") return void startBrowserCapture();
  if (selected === "scrcpy") return void startScrcpyCapture();
  if (selected === "obs") return void startObsBridgeCapture();
  const messages: Record<CaptureSource, string> = {
    adb: "",
    window: "",
    scrcpy: "",
    ndi: "NDI stream input is planned for iPhone/iPad users, but the backend decoder is not connected yet.",
    capture_card: "Capture card input is planned for HDMI/USB devices, but the backend decoder is not connected yet.",
    obs: ""
  };
  useCaptureRuntimeStore.setState({ error: messages[selected] });
}

async function startScrcpyCapture() {
  useCaptureRuntimeStore.setState({ error: "" });
  try {
    const canDecode = "VideoDecoder" in window && "EncodedVideoChunk" in window;
    const selectedCodec = useCaptureRuntimeStore.getState().selectedCodec;
    if (selectedCodec !== "h264") {
      const message = `${selectedCodec.toUpperCase()} is selectable as a source preset, but live browser preview/CV currently supports H.264 only. Use H.264 for realtime capture until backend decoding is wired for ${selectedCodec.toUpperCase()}.`;
      addCaptureLog("warn", message);
      useCaptureRuntimeStore.setState({ running: false, sourceMode: "idle", error: message, fps: 0, buffered: 0, nativeCrops: 0, sourceSize: { width: 0, height: 0 } });
      return;
    }
    if (!canDecode) {
      const message = "WebCodecs is unavailable in this browser, so realtime scrcpy preview cannot start. Use Chrome/Edge with WebCodecs or ADB Phone for still-frame testing.";
      addCaptureLog("error", message);
      useCaptureRuntimeStore.setState({ running: false, sourceMode: "idle", error: message });
      return;
    }
    resetBuffers();
    runtime.videoCodec = selectedCodec;
    useCaptureRuntimeStore.setState({ sourceMode: "scrcpy", running: true, sourceSize: { width: 0, height: 0 }, adbPreviewUrl: "" });
    startAgeTimer();
    await stopScrcpy().catch(() => {});
    await startScrcpyH264Decode();
    addCaptureLog("info", `Starting framed scrcpy H.264 stream at ${scrcpyMaxFps} FPS.`);
    const result = await startScrcpy({ maxFps: scrcpyMaxFps, videoBitRate: 6000000, background: true, decoder: "h264", videoCodec: "h264", rawStream: false });
    if (!result?.status?.ok) throw new Error(result?.status?.message ?? "scrcpy did not start.");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not start scrcpy.";
    addCaptureLog("error", message);
    useCaptureRuntimeStore.setState({ error: message, running: false, sourceMode: "idle" });
  }
}

function startScrcpyH264Decode() {
  runtime.h264Socket?.close();
  runtime.h264Decoder?.close?.();
  runtime.h264PendingMeta = [];
  runtime.h264ConfigPayload = null;
  runtime.h264RawBuffer = new Uint8Array(0);
  runtime.h264AuNals = [];
  runtime.h264AuHasVcl = false;
  runtime.h264AuKey = false;
  runtime.h264ParameterSets = [];
  runtime.h264CodecString = "";
  runtime.h264ReadyForKey = true;
  runtime.h264Configured = false;
  createH264Decoder();

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws/capture/scrcpy-h264`);
  runtime.h264Socket = socket;
  socket.binaryType = "arraybuffer";
  const opened = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Timed out opening scrcpy H.264 WebSocket.")), 3000);
    socket.addEventListener("open", () => {
      window.clearTimeout(timer);
      addCaptureLog("info", "scrcpy H.264 WebSocket opened.");
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("scrcpy H.264 WebSocket failed before startup."));
    }, { once: true });
  });
  socket.onmessage = (event) => {
    if (typeof event.data === "string") return handleScrcpyMessage(event.data);
    const meta = runtime.h264PendingMeta.shift();
    if (!meta) return appendRawH264Bytes(new Uint8Array(event.data));
    if (!meta.key && runtime.h264PendingMeta.length > 0) return;
    decodeScrcpyPayload(new Uint8Array(event.data), meta);
  };
  socket.onerror = () => {
    addCaptureLog("error", "scrcpy H.264 WebSocket failed.");
    useCaptureRuntimeStore.setState({ error: "scrcpy H.264 WebSocket failed; stop and restart capture if the phone stream changed." });
  };
  socket.onclose = () => {
    addCaptureLog("warn", "scrcpy H.264 WebSocket closed.");
    if (useCaptureRuntimeStore.getState().sourceMode === "scrcpy") useCaptureRuntimeStore.setState({ error: "scrcpy H.264 stream closed." });
  };
  return opened;
}

function createH264Decoder() {
  try {
    runtime.h264Decoder?.close?.();
  } catch {}
  runtime.h264Configured = false;
  runtime.h264Decoder = new (window as any).VideoDecoder({
    output: drawDecodedFrame,
    error: (error: Error) => {
      try {
        runtime.h264Decoder?.close?.();
      } catch {}
      runtime.h264Decoder = null;
      runtime.h264Configured = false;
      runtime.h264ReadyForKey = true;
      runtime.h264RawBuffer = new Uint8Array(0);
      runtime.h264AuNals = [];
      runtime.h264AuHasVcl = false;
      runtime.h264AuKey = false;
      addCaptureLog("error", `H.264 decoder reset: ${error.message}`);
      useCaptureRuntimeStore.setState({ error: `H.264 decoder reset: ${error.message}` });
    }
  });
}

function ensureH264DecoderConfigured() {
  if (!runtime.h264Decoder || runtime.h264Decoder.state === "closed") createH264Decoder();
  if (!runtime.h264Decoder || runtime.h264Configured) return true;
  const codec = webCodecsCodecString(runtime.videoCodec);
  try {
    runtime.h264Decoder.configure({
      codec,
      optimizeForLatency: true,
      ...(runtime.videoCodec === "h264" ? { avc: { format: "annexb" } } : {})
    });
  } catch {
    runtime.h264Decoder.configure({ codec, optimizeForLatency: true });
  }
  runtime.h264Configured = true;
  return true;
}

function webCodecsCodecString(codec: ScrcpyVideoCodec) {
  if (codec === "h265") return "hev1.1.6.L120.B0";
  if (codec === "av1") return "av01.0.08M.08";
  return runtime.h264CodecString || "avc1.42E01F";
}

function handleScrcpyMessage(data: string) {
  try {
    const message = JSON.parse(data);
    if (message.type === "scrcpy_frame") {
      runtime.h264PendingMeta.push(message);
    }
    if (message.type === "scrcpy_stream_meta" && message.width && message.height) {
      addCaptureLog("info", `scrcpy source ${Number(message.width)}x${Number(message.height)}.`);
      useCaptureRuntimeStore.setState({ sourceSize: { width: Number(message.width), height: Number(message.height) } });
    }
    if (message.type === "scrcpy_log" && message.message) addCaptureLog("info", String(message.message).slice(0, 180));
    if (message.type === "scrcpy_error") {
      const error = message.message ?? "scrcpy stream error.";
      addCaptureLog("error", error);
      useCaptureRuntimeStore.setState({ error });
    }
    if (message.type === "scrcpy_exit") addCaptureLog("warn", `scrcpy exited (${message.code ?? message.signal ?? "unknown"}).`);
  } catch {}
}

function decodeScrcpyPayload(payload: Uint8Array, meta: ScrcpyFrameMeta) {
  if (meta.config) {
    runtime.h264ConfigPayload = payload;
    return;
  }
  if (!ensureH264DecoderConfigured()) return;
  if (runtime.h264ReadyForKey && !meta.key) return;
  if (shouldDropQueuedH264Frame(Boolean(meta.key))) return;
  const data = meta.key && runtime.h264ConfigPayload ? concatBytes(runtime.h264ConfigPayload, payload) : payload;
  runtime.h264ReadyForKey = false;
  try {
    runtime.h264Decoder.decode(new (window as any).EncodedVideoChunk({
      type: meta.key ? "key" : "delta",
      timestamp: meta.ptsUs ?? Math.round(performance.now() * 1000),
      data
    }));
  } catch (caught) {
    runtime.h264ReadyForKey = true;
    runtime.h264Configured = false;
    if (caught instanceof Error && caught.message.includes("unconfigured")) return;
    const message = caught instanceof Error ? caught.message : "Could not decode scrcpy H.264 frame.";
    addCaptureLog("error", message);
    useCaptureRuntimeStore.setState({ error: message });
  }
}

function shouldDropQueuedH264Frame(key: boolean) {
  if (!runtime.h264Decoder) return false;
  const queueSize = runtime.h264Decoder.decodeQueueSize ?? 0;
  if (queueSize <= h264MaxDecodeQueue) return false;
  if (key) return false;
  try {
    runtime.h264Decoder.reset();
  } catch {}
  runtime.h264Configured = false;
  runtime.h264ReadyForKey = true;
  addCaptureLog("warn", "Decoder backlog cleared; waiting for next key frame.");
  return true;
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const next = new Uint8Array(a.byteLength + b.byteLength);
  next.set(a, 0);
  next.set(b, a.byteLength);
  return next;
}

function appendRawH264Bytes(bytes: Uint8Array) {
  const data = concatBytes(runtime.h264RawBuffer, bytes);
  const starts = findStartCodes(data);
  if (starts.length < 2) {
    runtime.h264RawBuffer = data;
    return;
  }
  for (let index = 0; index < starts.length - 1; index += 1) {
    processRawNal(data.subarray(starts[index], starts[index + 1]));
  }
  runtime.h264RawBuffer = data.subarray(starts[starts.length - 1]);
}

function findStartCodes(data: Uint8Array) {
  const starts: number[] = [];
  for (let i = 0; i < data.length - 3; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) starts.push(i);
    else if (i < data.length - 4 && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) starts.push(i);
  }
  return starts;
}

function nalPayloadOffset(nal: Uint8Array) {
  return nal[2] === 1 ? 3 : 4;
}

function processRawNal(nal: Uint8Array) {
  const offset = nalPayloadOffset(nal);
  if (nal.length <= offset) return;
  const nalType = nal[offset] & 0x1f;
  if (nalType === 9) {
    flushRawAccessUnit();
    return;
  }
  if (nalType === 7 || nalType === 8) {
    runtime.h264ParameterSets = [...runtime.h264ParameterSets.filter((item) => (item[nalPayloadOffset(item)] & 0x1f) !== nalType), nal];
    if (nalType === 7) updateH264CodecFromSps(nal, offset);
  }
  const isVcl = nalType === 1 || nalType === 5;
  if (isVcl && runtime.h264AuHasVcl && firstMbInSlice(nal, offset) === 0) flushRawAccessUnit();
  runtime.h264AuNals.push(nal);
  if (isVcl) runtime.h264AuHasVcl = true;
  if (nalType === 5) runtime.h264AuKey = true;
}

function firstMbInSlice(nal: Uint8Array, nalOffset: number) {
  const rbsp: number[] = [];
  let zeros = 0;
  for (let i = nalOffset + 1; i < nal.length; i += 1) {
    const value = nal[i];
    if (zeros >= 2 && value === 3) {
      zeros = 0;
      continue;
    }
    rbsp.push(value);
    zeros = value === 0 ? zeros + 1 : 0;
  }
  let bit = 0;
  let leadingZeroBits = 0;
  while (bit < rbsp.length * 8) {
    const value = (rbsp[bit >> 3] >> (7 - (bit & 7))) & 1;
    bit += 1;
    if (value) break;
    leadingZeroBits += 1;
  }
  let codeNum = (1 << leadingZeroBits) - 1;
  for (let i = 0; i < leadingZeroBits; i += 1) {
    const value = (rbsp[bit >> 3] >> (7 - (bit & 7))) & 1;
    bit += 1;
    codeNum += value << (leadingZeroBits - 1 - i);
  }
  return codeNum;
}

function updateH264CodecFromSps(nal: Uint8Array, nalOffset: number) {
  if (nal.length <= nalOffset + 3) return;
  const profile = nal[nalOffset + 1];
  const compatibility = nal[nalOffset + 2];
  const level = nal[nalOffset + 3];
  const codec = `avc1.${hexByte(profile)}${hexByte(compatibility)}${hexByte(level)}`;
  if (codec === runtime.h264CodecString) return;
  runtime.h264CodecString = codec;
  addCaptureLog("info", `H.264 profile detected: ${codec}.`);
}

function hexByte(value: number) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function flushRawAccessUnit() {
  if (!runtime.h264AuNals.length || !runtime.h264AuHasVcl) {
    runtime.h264AuNals = [];
    runtime.h264AuHasVcl = false;
    runtime.h264AuKey = false;
    return;
  }
  const hasParameterSet = runtime.h264AuNals.some((nal) => {
    const type = nal[nalPayloadOffset(nal)] & 0x1f;
    return type === 7 || type === 8;
  });
  const nals = runtime.h264AuKey && !hasParameterSet ? [...runtime.h264ParameterSets, ...runtime.h264AuNals] : runtime.h264AuNals;
  const data = concatMany(nals);
  runtime.h264AuNals = [];
  const key = runtime.h264AuKey;
  runtime.h264AuHasVcl = false;
  runtime.h264AuKey = false;
  if (!ensureH264DecoderConfigured()) return;
  if (runtime.h264ReadyForKey && !key) return;
  if (shouldDropQueuedH264Frame(key)) return;
  runtime.h264ReadyForKey = false;
  try {
    runtime.h264Decoder?.decode(new (window as any).EncodedVideoChunk({
      type: key ? "key" : "delta",
      timestamp: Math.round(performance.now() * 1000),
      data
    }));
  } catch (caught) {
    runtime.h264ReadyForKey = true;
    runtime.h264Configured = false;
    if (caught instanceof Error && caught.message.includes("unconfigured")) return;
    const message = caught instanceof Error ? caught.message : "Could not decode raw scrcpy H.264 access unit.";
    addCaptureLog("error", message);
    useCaptureRuntimeStore.setState({ error: message });
  }
}

function concatMany(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const next = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    next.set(part, offset);
    offset += part.byteLength;
  }
  return next;
}

function drawDecodedFrame(frame: any) {
  const canvas = runtime.canvas;
  if (!canvas) {
    frame.close();
    return;
  }
  const width = frame.displayWidth || frame.codedWidth;
  const height = frame.displayHeight || frame.codedHeight;
  if (!width || !height) {
    frame.close();
    return;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  updateSourceSize(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx?.drawImage(frame, 0, 0, width, height);
  if (runtime.previewCanvas) {
    if (runtime.previewCanvas.width !== width || runtime.previewCanvas.height !== height) {
      runtime.previewCanvas.width = width;
      runtime.previewCanvas.height = height;
    }
    runtime.previewCanvas.getContext("2d")?.drawImage(frame, 0, 0, width, height);
  }
  frame.close();
  if (useCaptureRuntimeStore.getState().error.startsWith("H.264")) {
    useCaptureRuntimeStore.setState({ error: "" });
  }
  analyzeCanvas(canvas, width, height);
}

async function startBrowserCapture() {
  useCaptureRuntimeStore.setState({ error: "" });
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    resetBuffers();
    runtime.stream = stream;
    if (runtime.video) {
      runtime.video.srcObject = stream;
      await runtime.video.play();
    }
    useCaptureRuntimeStore.setState({ sourceMode: "browser", running: true, stream });
    scheduleFrame();
    startAgeTimer();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not start screen capture.";
    addCaptureLog("error", message);
    useCaptureRuntimeStore.setState({ error: `${message}. Use ADB Native in this in-app browser, or open the app in Chrome/Edge for window capture.` });
  }
}

async function startAdbCapture() {
  useCaptureRuntimeStore.setState({ error: "" });
  resetBuffers();
  runtime.adbActive = true;
  addCaptureLog("warn", "ADB still-frame capture started. This is for testing, not low-latency realtime CV.");
  useCaptureRuntimeStore.setState({ sourceMode: "adb", running: true });
  startAgeTimer();
  void pollAdbFrame();
}

async function startObsBridgeCapture() {
  useCaptureRuntimeStore.setState({ error: "" });
  resetBuffers();
  runtime.obsBridgeActive = true;
  runtime.lastObsFrameAt = "";
  addCaptureLog("info", "Native OBS bridge selected. Waiting for decoded frames from the OBS scrcpy source.");
  useCaptureRuntimeStore.setState({ sourceMode: "obs", running: true });
  startAgeTimer();
  void pollObsBridgeFrame();
}

function resetBuffers() {
  runtime.frameBuffer = [];
  runtime.nativeCropBuffer.splice(0).forEach((crop) => crop.bitmap.close());
  runtime.previous = emptyMetrics();
  runtime.frameTimes = [];
  runtime.lastFrameAt = 0;
  runtime.lastVisionPostedAt = 0;
  runtime.visionPostInFlight = false;
  runtime.visionStability = createVisionStabilityState();
  useCaptureRuntimeStore.setState({ buffered: 0, nativeCrops: 0, fps: 0, lastFrameAge: null, minimapDetections: [], liveVision: null });
}

function scheduleFrame() {
  const video = runtime.video as any;
  if (!useCaptureRuntimeStore.getState().running || !video) return;
  if (video.requestVideoFrameCallback) {
    video.requestVideoFrameCallback(() => {
      processFrame();
      scheduleFrame();
    });
  } else {
    runtime.raf = requestAnimationFrame(() => {
      processFrame();
      scheduleFrame();
    });
  }
}

function processFrame() {
  const video = runtime.video;
  const canvas = runtime.canvas;
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
  const crop = resolveWindowContentCrop(video.videoWidth, video.videoHeight, useCaptureRuntimeStore.getState().windowContentCrop);
  const width = crop.width;
  const height = crop.height;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  updateSourceSize(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  if (runtime.previewCanvas) {
    if (runtime.previewCanvas.width !== width || runtime.previewCanvas.height !== height) {
      runtime.previewCanvas.width = width;
      runtime.previewCanvas.height = height;
    }
    runtime.previewCanvas.getContext("2d")?.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  }
  analyzeCanvas(canvas, width, height);
}

async function pollAdbFrame() {
  if (!runtime.adbActive) return;
  const started = performance.now();
  try {
    const response = await fetch(`/api/capture/frame?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const elapsed = performance.now() - started;
    if (elapsed > 1000) addCaptureLog("warn", `ADB frame took ${Math.round(elapsed)}ms.`);
    const blob = await response.blob();
    if (runtime.adbPreviewUrl) URL.revokeObjectURL(runtime.adbPreviewUrl);
    runtime.adbPreviewUrl = URL.createObjectURL(blob);
    useCaptureRuntimeStore.setState({ adbPreviewUrl: runtime.adbPreviewUrl });
    const bitmap = await createImageBitmap(blob);
    const canvas = runtime.canvas;
    if (canvas) {
      const width = bitmap.width;
      const height = bitmap.height;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      updateSourceSize(width, height);
      canvas.getContext("2d", { willReadFrequently: true })?.drawImage(bitmap, 0, 0);
      analyzeCanvas(canvas, width, height);
    }
    bitmap.close();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "ADB native frame capture failed.";
    addCaptureLog("error", message.slice(0, 180));
    useCaptureRuntimeStore.setState({ error: message });
  } finally {
    if (!runtime.adbActive) return;
    runtime.adbTimer = window.setTimeout(() => void pollAdbFrame(), Math.max(120, 450 - (performance.now() - started)));
  }
}

async function pollObsBridgeFrame() {
  if (!runtime.obsBridgeActive) return;
  try {
    const response = await fetch(`/api/capture/obs/frame?t=${Date.now()}`, { cache: "no-store" });
    if (response.status === 404) {
      useCaptureRuntimeStore.setState({ error: "Waiting for OBS frames. Add the scrcpy Device Source in OBS and enable its MLBB CoPilot CV bridge setting." });
      return;
    }
    if (!response.ok) throw new Error(await response.text());
    const capturedAt = response.headers.get("x-captured-at") ?? "";
    if (capturedAt && capturedAt === runtime.lastObsFrameAt) return;
    runtime.lastObsFrameAt = capturedAt;
    const blob = await response.blob();
    if (runtime.adbPreviewUrl) URL.revokeObjectURL(runtime.adbPreviewUrl);
    runtime.adbPreviewUrl = URL.createObjectURL(blob);
    useCaptureRuntimeStore.setState({ adbPreviewUrl: runtime.adbPreviewUrl, error: "" });
    const bitmap = await createImageBitmap(blob);
    const canvas = runtime.canvas;
    if (canvas) {
      const width = bitmap.width;
      const height = bitmap.height;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      updateSourceSize(width, height);
      canvas.getContext("2d", { willReadFrequently: true })?.drawImage(bitmap, 0, 0);
      analyzeCanvas(canvas, width, height);
    }
    bitmap.close();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Native OBS bridge frame failed.";
    addCaptureLog("error", message.slice(0, 180));
    useCaptureRuntimeStore.setState({ error: message });
  } finally {
    if (!runtime.obsBridgeActive) return;
    runtime.adbTimer = window.setTimeout(() => void pollObsBridgeFrame(), 120);
  }
}

function analyzeCanvas(canvas: HTMLCanvasElement, width: number, height: number, sourceOverride?: SourceMode) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  void ensureActiveCalibrationRegions();
  const frameRegions = calibratedRuntimeRegions();
  const metrics = emptyMetrics();
  for (const region of frameRegions) metrics[region.key] = sampleRegion(ctx, width, height, region, runtime.previous[region.key]);
  const probeMetrics = Object.fromEntries(calibratedVisionProbes().map((probe) => [probe.key, sampleRegion(ctx, width, height, probe)]));
  runtime.previous = metrics;

  const now = performance.now();
  runtime.lastFrameAt = now;
  runtime.frameBuffer.push({ time: now, sourceWidth: width, sourceHeight: height, regions: metrics });
  while (runtime.frameBuffer.length > maxBufferedFrames) runtime.frameBuffer.shift();
  queueNativeWindowCrops(canvas, width, height, now, metrics, frameRegions);
  const minimapDetections = detectMinimapMarkers(ctx, width, height, now, frameRegions);
  const draftContext = detectDraftVisualContext(canvas);
  const rawVision = classifyVisionFrame(metrics, probeMetrics, minimapDetections, Boolean(draftContext.selfSlot || draftContext.firstPickSide), runtime.trainedScreenModel);
  const liveVision = sourceOverride === "recording"
    ? rawVision
    : stabilizeVisionFrame(rawVision, runtime.visionStability);
  const trustedMinimapDetections = liveVision.screen === "draft" ? [] : minimapDetections;

  runtime.frameTimes.push(now);
  while (runtime.frameTimes.length && now - runtime.frameTimes[0] > 1000) runtime.frameTimes.shift();

  useCaptureRuntimeStore.setState({
    metrics,
    buffered: runtime.frameBuffer.length,
    nativeCrops: runtime.nativeCropBuffer.length,
    fps: runtime.frameTimes.length,
    lastFrameAge: 0,
    minimapDetections: trustedMinimapDetections,
    liveVision
  });
  queueLiveVisionFrame(canvas, liveVision, metrics, probeMetrics, trustedMinimapDetections, sourceOverride);
  if (!runtime.ultralyticsReady && !runtime.ultralyticsStatusLoading && now - runtime.lastUltralyticsStatusAt > 10000) {
    void loadUltralyticsStatus();
  }
  if ((sourceOverride ?? useCaptureRuntimeStore.getState().sourceMode) !== "obs") {
    queueUltralyticsLiveFrame(canvas, liveVision);
  }
  queueDraftBanIconRecognition(canvas, liveVision, sourceOverride ?? useCaptureRuntimeStore.getState().sourceMode);
  return liveVision;
}

function sampleRegion(ctx: CanvasRenderingContext2D, width: number, height: number, region: Region | VisionProbe, previous?: RegionMetrics): RegionMetrics {
  const { x, y, w, h } = pixelRegion(width, height, region);
  const data = ctx.getImageData(x, y, w, h).data;
  let sum = 0;
  let sumSq = 0;
  const stride = Math.max(4, Math.floor(data.length / 900) - (Math.floor(data.length / 900) % 4));
  let count = 0;
  for (let i = 0; i < data.length; i += stride) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    sum += luma;
    sumSq += luma * luma;
    count += 1;
  }
  const mean = count ? sum / count : 0;
  const variance = count ? Math.max(0, sumSq / count - mean * mean) : 0;
  const contrast = Math.sqrt(variance);
  const changed = previous ? Math.abs(mean - previous.mean) + Math.abs(contrast - previous.contrast) * 0.45 : 0;
  const active = region.key.includes("window") ? contrast > 34 && changed > 7 : changed > 5;
  return { mean, contrast, changed, active };
}

export function classifyVisionFrame(
  metrics: Record<RegionKey, RegionMetrics>,
  probes: Record<string, RegionMetrics>,
  markers: MinimapMarkerDetection[],
  hasDraftContext = false,
  learnedModel: TrainedScreenStateModel | null = null
): LiveVisionFrame {
  const evidence: string[] = [];
  const minimap = metrics.minimap;
  const topHud = probes.top_hud;
  const leftRail = probes.draft_left_rail;
  const rightRail = probes.draft_right_rail;
  const center = probes.center_panel;
  const modal = probes.modal_body;
  const minimapVisible = minimap.contrast > 22 && minimap.mean > 12;
  const modalVisible =
    modal.contrast > 30 &&
    topHud.contrast < 20 &&
    (metrics.equipment_window.contrast > 30 || metrics.attributes_window.contrast > 30);
  const railsVisible = leftRail.contrast > 28 && rightRail.contrast > 28;
  const lobbyVisible =
    minimapVisible &&
    railsVisible &&
    topHud.mean > 55 &&
    center.mean > 95 &&
    center.contrast > 35;
  const contextualDraftVisible =
    hasDraftContext &&
    center.mean < 90 &&
    center.contrast > 42 &&
    (leftRail.mean < 75 || rightRail.mean < 75);
  const completedDraftVisible =
    railsVisible &&
    center.contrast > 27 &&
    center.mean < 85 &&
    Math.max(leftRail.contrast, rightRail.contrast) > 38;
  const learned = learnedModel
    ? classifyWithTrainedScreenStateModel(learnedModel, metrics, probes)
    : null;

  if (modalVisible) {
    evidence.push("large scoreboard modal", "dimmed top HUD behind modal");
    return { screen: "scoreboard", confidence: 0.78, evidence, timestamp: Date.now() };
  }
  if (lobbyVisible) {
    evidence.push("bright lobby center composition", "side navigation panels visible");
    return { screen: "lobby", confidence: 0.72, evidence, timestamp: Date.now() };
  }
  if (contextualDraftVisible) {
    evidence.push("confirmed draft context marker");
    return { screen: "draft", confidence: 0.78, evidence, timestamp: Date.now() };
  }
  if (learned?.accepted && learned.confidence >= 0.58) {
    evidence.push(`trained screen model: ${learned.screen}`);
    return { screen: learned.screen, confidence: learned.confidence, evidence, timestamp: Date.now() };
  }
  if (completedDraftVisible) {
    evidence.push("completed draft portrait rails", "center preparation region");
    return { screen: "draft", confidence: 0.72, evidence, timestamp: Date.now() };
  }
  if (railsVisible && center.mean < 90 && center.contrast > 27 && (leftRail.mean < 78 || rightRail.mean < 78)) {
    evidence.push("draft side rails", "center selection region");
    return { screen: "draft", confidence: 0.68, evidence, timestamp: Date.now() };
  }
  if (minimapVisible) {
    evidence.push("minimap texture detected");
    if (markers.length) evidence.push(`${markers.length} minimap marker candidates`);
    if (center.mean < 32 && topHud.mean < 38) {
      evidence.push("dimmed center and HUD");
      return { screen: "death_replay", confidence: 0.54, evidence, timestamp: Date.now() };
    }
    return { screen: "live_hud", confidence: markers.length ? 0.74 : 0.6, evidence, timestamp: Date.now() };
  }
  if (center.contrast > 36 && topHud.contrast < 24) {
    evidence.push("large center composition without live HUD");
    return { screen: "loading", confidence: 0.4, evidence, timestamp: Date.now() };
  }
  evidence.push("no stable screen signature yet");
  return { screen: "unknown", confidence: 0.2, evidence, timestamp: Date.now() };
}

function requiredStableFrames(current: VisionScreenState | null, next: VisionScreenState, confidence: number) {
  if (!current) return confidence >= 0.7 ? 2 : 3;
  if (next === "unknown") return 6;
  if (next === "loading") return 4;
  if (next === "draft" && confidence >= 0.75) return 2;
  return 3;
}

function frameCanChallengeConfirmedState(frame: LiveVisionFrame) {
  return frame.screen === "unknown" || frame.screen === "loading" || frame.confidence >= 0.52;
}

export function stabilizeVisionFrame(frame: LiveVisionFrame, state: VisionStabilityState): LiveVisionFrame {
  const current = state.confirmed;
  if (current?.screen === frame.screen) {
    state.candidate = null;
    state.candidateFrames = 0;
    state.confirmed = {
      ...frame,
      confidence: Math.max(frame.confidence, current.confidence * 0.94)
    };
    return state.confirmed;
  }

  if (current && !frameCanChallengeConfirmedState(frame)) {
    state.candidate = null;
    state.candidateFrames = 0;
    state.confirmed = {
      ...current,
      timestamp: frame.timestamp,
      confidence: Math.max(0.55, current.confidence * 0.97),
      evidence: [...current.evidence.slice(0, 2), `held ${current.screen} through weak ${frame.screen} signal`]
    };
    return state.confirmed;
  }

  state.candidateFrames = state.candidate?.screen === frame.screen ? state.candidateFrames + 1 : 1;
  state.candidate = frame;
  const required = requiredStableFrames(current?.screen ?? null, frame.screen, frame.confidence);

  if (!current && (frame.screen === "unknown" || frame.screen === "loading")) {
    return frame;
  }

  if (state.candidateFrames >= required) {
    state.confirmed = {
      ...frame,
      evidence: [...frame.evidence, `screen state held for ${required} frames`]
    };
    state.candidate = null;
    state.candidateFrames = 0;
    return state.confirmed;
  }

  if (!current) {
    return {
      ...frame,
      screen: "unknown",
      confidence: Math.min(frame.confidence, 0.4),
      evidence: [...frame.evidence, `confirming ${frame.screen} (${state.candidateFrames}/${required})`]
    };
  }

  state.confirmed = {
    ...current,
    timestamp: frame.timestamp,
    confidence: Math.max(0.55, current.confidence - 0.02),
    evidence: [...current.evidence.slice(0, 2), `holding ${current.screen}; ${frame.screen} pending (${state.candidateFrames}/${required})`]
  };
  return state.confirmed;
}

function queueLiveVisionFrame(
  canvas: HTMLCanvasElement,
  vision: LiveVisionFrame,
  metrics: Record<RegionKey, RegionMetrics>,
  probes: Record<string, RegionMetrics>,
  minimapMarkers: MinimapMarkerDetection[],
  sourceOverride?: SourceMode
) {
  const now = performance.now();
  if (runtime.visionPostInFlight || now - runtime.lastVisionPostedAt < 350) return;
  runtime.lastVisionPostedAt = now;
  runtime.visionPostInFlight = true;
  const source = sourceOverride ?? useCaptureRuntimeStore.getState().sourceMode;
  void (async () => {
    const equipmentItems = vision.screen === "scoreboard" ? await detectEquipmentItems(canvas) : [];
    const allyEquipment = equipmentItems.filter((item) => item.side === "ally");
    const enemyEquipment = equipmentItems.filter((item) => item.side === "enemy");
    return ingestLiveVisionFrame({
      source,
      timestamp: Date.now(),
      screen: vision.screen,
      confidence: vision.confidence,
      evidence: equipmentItems.length
        ? [...vision.evidence, `${allyEquipment.length} ally / ${enemyEquipment.length} enemy equipment icons confirmed`]
        : vision.evidence,
      regions: { ...metrics, ...probes },
      minimapMarkers,
      ...(equipmentItems.length ? { signals: { allyEquipment, enemyEquipment } } : {}),
    });
  })().then((result) => {
    const data = result.data ?? result;
    useCaptureRuntimeStore.setState({
      liveVision: {
        screen: data.screen ?? vision.screen,
        confidence: Number(data.confidence ?? vision.confidence),
        evidence: data.evidence ?? vision.evidence,
        directorScene: data.directorScene,
        timestamp: Number(data.timestamp ?? vision.timestamp),
        source: data.source ?? source,
        signals: data.signals,
      }
    });
  }).catch(() => {}).finally(() => {
    runtime.visionPostInFlight = false;
  });
}

function queueUltralyticsLiveFrame(canvas: HTMLCanvasElement, vision: LiveVisionFrame) {
  const now = performance.now();
  if (!runtime.ultralyticsReady || runtime.ultralyticsFrameInFlight || now - runtime.lastUltralyticsAt < 1200) return;
  runtime.lastUltralyticsAt = now;
  runtime.ultralyticsFrameInFlight = true;
  void canvasToBlob(canvas).then(async (blob) => {
    const result = await inferUltralyticsFrame(blob);
    const data = result.data ?? result;
    const detections = Array.isArray(data.detections) ? data.detections as UltralyticsDetection[] : [];
    const minimapMarkers = Array.isArray(data.minimapMarkers) ? data.minimapMarkers : [];
    const minimapObjects = Array.isArray(data.minimapObjects) ? data.minimapObjects : [];
    const surface = detectedYoloScreen(detections);
    if (!detections.length && !surface) return;
    const screen = surface?.screen ?? vision.screen;
    const confidence = Math.max(Number(vision.confidence), Number(surface?.confidence ?? 0));
    const response = await ingestLiveVisionFrame({
      source: "ultralytics-yolo",
      timestamp: Date.now(),
      screen,
      confidence,
      evidence: [
        ...vision.evidence,
        ...(surface ? [`YOLO surface: ${surface.label}`] : []),
        ...(minimapMarkers.length ? [`YOLO minimap markers: ${minimapMarkers.length}`] : []),
        ...(minimapObjects.length ? [`YOLO minimap objects: ${minimapObjects.length}`] : []),
      ],
      minimapMarkers,
      signals: { yoloDetections: detections, minimapObjects },
    });
    const ingested = response.data ?? response;
    useCaptureRuntimeStore.setState({
      liveVision: {
        screen: ingested.screen ?? screen,
        confidence: Number(ingested.confidence ?? confidence),
        evidence: ingested.evidence ?? vision.evidence,
        directorScene: ingested.directorScene,
        timestamp: Number(ingested.timestamp ?? Date.now()),
        source: ingested.source ?? "ultralytics-yolo",
        signals: ingested.signals,
      },
    });
  }).catch(() => {}).finally(() => {
    runtime.ultralyticsFrameInFlight = false;
  });
}

function detectedYoloScreen(detections: UltralyticsDetection[]) {
  const mappings: Record<string, VisionScreenState> = {
    minimap_panel: "live_hud",
    draft_screen: "draft",
    ally_pick_slot: "draft",
    enemy_pick_slot: "draft",
    ally_ban_slot: "draft",
    enemy_ban_slot: "draft",
    lane_marker: "draft",
    battle_spell_marker: "draft",
    equipment_scoreboard: "scoreboard",
    attributes_scoreboard: "scoreboard",
  };
  const accepted = detections
    .filter((detection) => mappings[detection.className] && detection.confidence >= 0.55)
    .sort((left, right) => right.confidence - left.confidence)[0];
  return accepted ? { screen: mappings[accepted.className], label: accepted.className, confidence: accepted.confidence } : null;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode frame.")), "image/jpeg", 0.82);
  });
}

function detectMinimapMarkers(ctx: CanvasRenderingContext2D, width: number, height: number, sampledAt: number, frameRegions = calibratedRuntimeRegions()): MinimapMarkerDetection[] {
  const region = frameRegions.find((item) => item.key === "minimap");
  if (!region) return [];
  const { x, y, w, h } = pixelRegion(width, height, region);
  let image: ImageData;
  try {
    image = ctx.getImageData(x, y, w, h);
  } catch {
    return [];
  }

  return detectMinimapMarkerCandidatesFromRgba(image.data, image.width, image.height, sampledAt);
}

function pixelRegion(width: number, height: number, region: Region | VisionProbe): PixelRegion {
  const [rx, ry, rw, rh] = region.rect;
  const x = Math.max(0, Math.floor(rx * width));
  const y = Math.max(0, Math.floor(ry * height));
  const w = Math.max(1, Math.min(width - x, Math.floor(rw * width)));
  const h = Math.max(1, Math.min(height - y, Math.floor(rh * height)));
  if (region.key !== "minimap") return { x, y, w, h };

  const side = Math.max(1, Math.min(w, h));
  return {
    x: Math.max(0, Math.min(width - side, x + Math.round((w - side) / 2))),
    y: Math.max(0, Math.min(height - side, y + Math.round((h - side) / 2))),
    w: side,
    h: side
  };
}

function queueNativeWindowCrops(canvas: HTMLCanvasElement, width: number, height: number, time: number, metrics: Record<RegionKey, RegionMetrics>, frameRegions = calibratedRuntimeRegions()) {
  for (const region of frameRegions) {
    if (!region.key.includes("window")) continue;
    const item = metrics[region.key];
    if (!item.active && item.changed < 5) continue;
    const [rx, ry, rw, rh] = region.rect;
    void createImageBitmap(canvas, Math.floor(rx * width), Math.floor(ry * height), Math.max(1, Math.floor(rw * width)), Math.max(1, Math.floor(rh * height))).then((bitmap) => {
      runtime.nativeCropBuffer.push({ time, key: region.key, width: bitmap.width, height: bitmap.height, bitmap });
      while (runtime.nativeCropBuffer.length > maxNativeCrops) runtime.nativeCropBuffer.shift()?.bitmap.close();
      useCaptureRuntimeStore.setState({ nativeCrops: runtime.nativeCropBuffer.length });
    }).catch(() => {});
  }
}

function updateSourceSize(width: number, height: number) {
  const current = useCaptureRuntimeStore.getState().sourceSize;
  if (current.width === width && current.height === height) return;
  useCaptureRuntimeStore.setState({ sourceSize: { width, height } });
}

function startAgeTimer() {
  if (runtime.ageTimer != null) window.clearInterval(runtime.ageTimer);
  runtime.ageTimer = window.setInterval(() => {
    const now = performance.now();
    while (runtime.frameTimes.length && now - runtime.frameTimes[0] > 1000) runtime.frameTimes.shift();
    const age = runtime.lastFrameAt ? now - runtime.lastFrameAt : null;
    if (age != null && age > 1000) {
      runtime.frameBuffer = [];
      runtime.nativeCropBuffer.splice(0).forEach((crop) => crop.bitmap.close());
      useCaptureRuntimeStore.setState({ nativeCrops: 0 });
    }
    useCaptureRuntimeStore.setState({
      buffered: runtime.frameBuffer.length,
      fps: runtime.frameTimes.length,
      lastFrameAge: age
    });
  }, 250);
}
