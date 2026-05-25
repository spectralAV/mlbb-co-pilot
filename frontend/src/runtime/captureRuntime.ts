import { create } from "zustand";
import { ingestLiveVisionFrame, startScrcpy, stopScrcpy } from "../api/client";
import { queueDraftHeroRecognition } from "../vision/draftHeroDetector";

export type RegionKey = "equipment_window" | "attributes_window" | "scoreboard" | "minimap";
export type Region = { key: RegionKey; label: string; rect: [number, number, number, number] };
export type RegionMetrics = { mean: number; contrast: number; changed: number; active: boolean };
export type CaptureSource = "adb" | "window" | "scrcpy" | "ndi" | "capture_card" | "obs";
export type SourceMode = "idle" | "browser" | "adb" | "scrcpy" | "obs";
export type ScrcpyVideoCodec = "h264" | "h265" | "av1";
export type CaptureLogEntry = { time: number; level: "info" | "warn" | "error"; message: string };
type NativeCrop = { time: number; key: RegionKey; width: number; height: number; bitmap: ImageBitmap };
type FrameSummary = { time: number; sourceWidth: number; sourceHeight: number; regions: Record<RegionKey, RegionMetrics> };
type ScrcpyFrameMeta = { type: "scrcpy_frame"; config?: boolean; key?: boolean; ptsUs?: number; size?: number };
type PixelRegion = { x: number; y: number; w: number; h: number };
type VisionProbe = { key: string; rect: [number, number, number, number] };
export type MinimapMarkerDetection = {
  id: string;
  side: "ally" | "enemy";
  minimap: [number, number];
  confidence: number;
  sampledAt: number;
};
export type VisionScreenState = "unknown" | "draft" | "loading" | "live_hud" | "death_replay" | "scoreboard" | "item_shop";
export type LiveVisionFrame = {
  screen: VisionScreenState;
  confidence: number;
  evidence: string[];
  directorScene?: "main" | "map" | "text" | "counter" | "picks";
  timestamp: number;
  source?: string;
};

export const regions: Region[] = [
  { key: "equipment_window", label: "Equipment Window", rect: [0.58, 0.08, 0.38, 0.78] },
  { key: "attributes_window", label: "Attributes Window", rect: [0.42, 0.08, 0.54, 0.78] },
  { key: "scoreboard", label: "Top HUD", rect: [0.32, 0, 0.36, 0.08] },
  { key: "minimap", label: "Minimap", rect: [0.02521, 0, 0.146359, 0.326563] }
];

const visionProbes: VisionProbe[] = [
  { key: "top_hud", rect: [0.28, 0, 0.45, 0.08] },
  { key: "draft_left_rail", rect: [0, 0.08, 0.22, 0.84] },
  { key: "draft_right_rail", rect: [0.78, 0.08, 0.22, 0.84] },
  { key: "center_panel", rect: [0.27, 0.1, 0.48, 0.64] },
  { key: "modal_body", rect: [0.1, 0.13, 0.8, 0.78] }
];

export const maxBufferedFrames = 60;
export const maxNativeCrops = 96;
const scrcpyMaxFps = 60;
const h264MaxDecodeQueue = 3;

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
  setSelectedSource: (source: CaptureSource) => void;
  setSelectedCodec: (codec: ScrcpyVideoCodec) => void;
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
  setSelectedSource: (selectedSource) => set({ selectedSource }),
  setSelectedCodec: (selectedCodec) => set({ selectedCodec })
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
  raf: null as number | null,
  ageTimer: null as number | null
};

export function attachCaptureRuntime(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null) {
  runtime.video = video;
  runtime.canvas = canvas;
  if (video && runtime.stream) {
    video.srcObject = runtime.stream;
    void video.play().catch(() => {});
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

export function attachScrcpyPreviewCanvas(canvas: HTMLCanvasElement | null) {
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
    addCaptureLog("info", "Starting scrcpy H.264 raw Annex-B stream at 60 FPS.");
    const result = await startScrcpy({ maxFps: scrcpyMaxFps, videoBitRate: 8000000, background: true, decoder: "h264", videoCodec: "h264", rawStream: true });
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
  return !key;
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
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  updateSourceSize(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, width, height);
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

function analyzeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const metrics = emptyMetrics();
  for (const region of regions) metrics[region.key] = sampleRegion(ctx, width, height, region, runtime.previous[region.key]);
  const probeMetrics = Object.fromEntries(visionProbes.map((probe) => [probe.key, sampleRegion(ctx, width, height, probe)]));
  runtime.previous = metrics;

  const now = performance.now();
  runtime.lastFrameAt = now;
  runtime.frameBuffer.push({ time: now, sourceWidth: width, sourceHeight: height, regions: metrics });
  while (runtime.frameBuffer.length > maxBufferedFrames) runtime.frameBuffer.shift();
  queueNativeWindowCrops(canvas, width, height, now, metrics);
  const minimapDetections = detectMinimapMarkers(ctx, width, height, now);
  const liveVision = classifyVisionFrame(metrics, probeMetrics, minimapDetections);

  runtime.frameTimes.push(now);
  while (runtime.frameTimes.length && now - runtime.frameTimes[0] > 1000) runtime.frameTimes.shift();

  useCaptureRuntimeStore.setState({
    metrics,
    buffered: runtime.frameBuffer.length,
    nativeCrops: runtime.nativeCropBuffer.length,
    fps: runtime.frameTimes.length,
    lastFrameAge: 0,
    minimapDetections,
    liveVision
  });
  queueLiveVisionFrame(liveVision, metrics, probeMetrics, minimapDetections);
  queueDraftHeroRecognition(canvas, liveVision, useCaptureRuntimeStore.getState().sourceMode);
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
  markers: MinimapMarkerDetection[]
): LiveVisionFrame {
  const evidence: string[] = [];
  const minimap = metrics.minimap;
  const topHud = probes.top_hud;
  const leftRail = probes.draft_left_rail;
  const rightRail = probes.draft_right_rail;
  const center = probes.center_panel;
  const modal = probes.modal_body;
  const minimapVisible = minimap.contrast > 22 && minimap.mean > 12;
  const modalVisible = modal.contrast > 42 && (metrics.equipment_window.contrast > 38 || metrics.attributes_window.contrast > 38);
  const railsVisible = leftRail.contrast > 28 && rightRail.contrast > 28;

  if (modalVisible && minimapVisible) {
    evidence.push("large modal over live HUD", "minimap remains visible");
    return { screen: "scoreboard", confidence: 0.68, evidence, timestamp: Date.now() };
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
  if (railsVisible && center.contrast > 30) {
    evidence.push("draft side rails", "center selection region");
    return { screen: "draft", confidence: 0.56, evidence, timestamp: Date.now() };
  }
  if (center.contrast > 36 && topHud.contrast < 24) {
    evidence.push("large center composition without live HUD");
    return { screen: "loading", confidence: 0.4, evidence, timestamp: Date.now() };
  }
  evidence.push("no stable screen signature yet");
  return { screen: "unknown", confidence: 0.2, evidence, timestamp: Date.now() };
}

function queueLiveVisionFrame(
  vision: LiveVisionFrame,
  metrics: Record<RegionKey, RegionMetrics>,
  probes: Record<string, RegionMetrics>,
  minimapMarkers: MinimapMarkerDetection[]
) {
  const now = performance.now();
  if (runtime.visionPostInFlight || now - runtime.lastVisionPostedAt < 350) return;
  runtime.lastVisionPostedAt = now;
  runtime.visionPostInFlight = true;
  const source = useCaptureRuntimeStore.getState().sourceMode;
  void ingestLiveVisionFrame({
    source,
    timestamp: Date.now(),
    screen: vision.screen,
    confidence: vision.confidence,
    evidence: vision.evidence,
    regions: { ...metrics, ...probes },
    minimapMarkers
  }).then((result) => {
    const data = result.data ?? result;
    useCaptureRuntimeStore.setState({
      liveVision: {
        screen: data.screen ?? vision.screen,
        confidence: Number(data.confidence ?? vision.confidence),
        evidence: data.evidence ?? vision.evidence,
        directorScene: data.directorScene,
        timestamp: Number(data.timestamp ?? vision.timestamp),
        source: data.source ?? source
      }
    });
  }).catch(() => {}).finally(() => {
    runtime.visionPostInFlight = false;
  });
}

function detectMinimapMarkers(ctx: CanvasRenderingContext2D, width: number, height: number, sampledAt: number): MinimapMarkerDetection[] {
  const region = regions.find((item) => item.key === "minimap");
  if (!region) return [];
  const { x, y, w, h } = pixelRegion(width, height, region);
  const gridW = 96;
  const gridH = 96;
  let image: ImageData;
  try {
    image = ctx.getImageData(x, y, w, h);
  } catch {
    return [];
  }

  const allyMask = new Uint8Array(gridW * gridH);
  const enemyMask = new Uint8Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy += 1) {
    const py = Math.min(h - 1, Math.floor((gy / gridH) * h));
    for (let gx = 0; gx < gridW; gx += 1) {
      const px = Math.min(w - 1, Math.floor((gx / gridW) * w));
      const pixel = (py * w + px) * 4;
      const r = image.data[pixel];
      const g = image.data[pixel + 1];
      const b = image.data[pixel + 2];
      const a = image.data[pixel + 3];
      if (a < 16) continue;
      const index = gy * gridW + gx;
      if (isAllyMinimapPixel(r, g, b)) allyMask[index] = 1;
      else if (isEnemyMinimapPixel(r, g, b)) enemyMask[index] = 1;
    }
  }

  return [
    ...extractMarkerComponents("ally", allyMask, gridW, gridH, sampledAt),
    ...extractMarkerComponents("enemy", enemyMask, gridW, gridH, sampledAt)
  ]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((marker, index) => ({ ...marker, id: `${marker.side}-${index}` }));
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

function isAllyMinimapPixel(r: number, g: number, b: number) {
  return b > 125 && g > 85 && r < 135 && b - r > 35;
}

function isEnemyMinimapPixel(r: number, g: number, b: number) {
  return r > 145 && g < 145 && r - b > 35;
}

function extractMarkerComponents(side: "ally" | "enemy", mask: Uint8Array, gridW: number, gridH: number, sampledAt: number): MinimapMarkerDetection[] {
  const visited = new Uint8Array(mask.length);
  const detections: MinimapMarkerDetection[] = [];
  const queue: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const cx = current % gridW;
      const cy = Math.floor(current / gridW);
      area += 1;
      sumX += cx;
      sumY += cy;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const next = ny * gridW + nx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    if (area < 4 || area > 450) continue;
    detections.push({
      id: `${side}-${detections.length}`,
      side,
      minimap: [sumX / area / (gridW - 1), sumY / area / (gridH - 1)],
      confidence: Math.max(0.25, Math.min(0.98, area / 80)),
      sampledAt
    });
  }

  return detections;
}

function queueNativeWindowCrops(canvas: HTMLCanvasElement, width: number, height: number, time: number, metrics: Record<RegionKey, RegionMetrics>) {
  for (const region of regions) {
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
