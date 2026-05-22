import { create } from "zustand";
import { startScrcpy, stopScrcpy } from "../api/client";

export type RegionKey = "equipment_window" | "attributes_window" | "scoreboard" | "minimap";
export type Region = { key: RegionKey; label: string; rect: [number, number, number, number] };
export type RegionMetrics = { mean: number; contrast: number; changed: number; active: boolean };
export type CaptureSource = "adb" | "window" | "scrcpy" | "ndi" | "capture_card" | "obs";
export type SourceMode = "idle" | "browser" | "adb" | "scrcpy";
type NativeCrop = { time: number; key: RegionKey; width: number; height: number; bitmap: ImageBitmap };
type FrameSummary = { time: number; sourceWidth: number; sourceHeight: number; regions: Record<RegionKey, RegionMetrics> };
type ScrcpyFrameMeta = { type: "scrcpy_frame"; config?: boolean; key?: boolean; ptsUs?: number; size?: number };

export const regions: Region[] = [
  { key: "equipment_window", label: "Equipment Window", rect: [0.58, 0.08, 0.38, 0.78] },
  { key: "attributes_window", label: "Attributes Window", rect: [0.42, 0.08, 0.54, 0.78] },
  { key: "scoreboard", label: "Top HUD", rect: [0.32, 0, 0.36, 0.08] },
  { key: "minimap", label: "Minimap", rect: [0.01, 0.02, 0.17, 0.28] }
];

export const maxBufferedFrames = 180;
export const maxNativeCrops = 96;

export const captureSources: Array<{
  id: CaptureSource;
  title: string;
  state: "ready" | "permission" | "planned" | "optional";
  detail: string;
}> = [
  { id: "adb", title: "ADB Phone", state: "ready", detail: "Native pixels, works in this browser, slower frame rate." },
  { id: "scrcpy", title: "Backend scrcpy", state: "ready", detail: "Direct H.264 stream decoded with WebCodecs; falls back to ADB frames if needed." },
  { id: "ndi", title: "NDI Stream", state: "planned", detail: "iPhone/iPad friendly network video source for backend decoding." },
  { id: "capture_card", title: "Capture Card", state: "planned", detail: "HDMI/USB video input for phones, tablets, or external devices." },
  { id: "window", title: "Window Share", state: "permission", detail: "Fast when browser screen-share permission is available." },
  { id: "obs", title: "OBS / Camera", state: "optional", detail: "Optional desktop/streaming setup, not required." }
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
  fps: number;
  buffered: number;
  nativeCrops: number;
  sourceSize: { width: number; height: number };
  lastFrameAge: number | null;
  metrics: Record<RegionKey, RegionMetrics>;
  error: string;
  adbPreviewUrl: string;
  stream: MediaStream | null;
  setSelectedSource: (source: CaptureSource) => void;
};

export const useCaptureRuntimeStore = create<CaptureRuntimeState>((set) => ({
  running: false,
  sourceMode: "idle",
  selectedSource: "adb",
  fps: 0,
  buffered: 0,
  nativeCrops: 0,
  sourceSize: { width: 0, height: 0 },
  lastFrameAge: null,
  metrics: emptyMetrics(),
  error: "",
  adbPreviewUrl: "",
  stream: null,
  setSelectedSource: (selectedSource) => set({ selectedSource })
}));

const runtime = {
  video: null as HTMLVideoElement | null,
  canvas: null as HTMLCanvasElement | null,
  previewCanvas: null as HTMLCanvasElement | null,
  adbPreviewUrl: "",
  adbTimer: null as number | null,
  adbActive: false,
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
  stream: null as MediaStream | null,
  frameBuffer: [] as FrameSummary[],
  nativeCropBuffer: [] as NativeCrop[],
  previous: emptyMetrics(),
  frameTimes: [] as number[],
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

export function attachScrcpyPreviewCanvas(canvas: HTMLCanvasElement | null) {
  runtime.previewCanvas = canvas;
}

export function stopCaptureRuntime() {
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
  runtime.adbActive = false;
  runtime.stream?.getTracks().forEach((track) => track.stop());
  runtime.stream = null;
  if (runtime.video) runtime.video.srcObject = null;
  if (runtime.adbPreviewUrl) URL.revokeObjectURL(runtime.adbPreviewUrl);
  runtime.adbPreviewUrl = "";
  runtime.nativeCropBuffer.splice(0).forEach((crop) => crop.bitmap.close());
  const mode = useCaptureRuntimeStore.getState().sourceMode;
  if (mode === "scrcpy") void stopScrcpy().catch(() => {});
  useCaptureRuntimeStore.setState({ running: false, sourceMode: "idle", stream: null, adbPreviewUrl: "", nativeCrops: 0, fps: 0, lastFrameAge: null });
}

export function startSelectedCaptureRuntime() {
  const selected = useCaptureRuntimeStore.getState().selectedSource;
  if (selected === "adb") return void startAdbCapture();
  if (selected === "window") return void startBrowserCapture();
  if (selected === "scrcpy") return void startScrcpyCapture();
  const messages: Record<CaptureSource, string> = {
    adb: "",
    window: "",
    scrcpy: "",
    ndi: "NDI stream input is planned for iPhone/iPad users, but the backend decoder is not connected yet.",
    capture_card: "Capture card input is planned for HDMI/USB devices, but the backend decoder is not connected yet.",
    obs: "OBS/camera capture is optional and not connected yet. Use ADB Phone now, or backend scrcpy once the decoder is connected."
  };
  useCaptureRuntimeStore.setState({ error: messages[selected] });
}

async function startScrcpyCapture() {
  useCaptureRuntimeStore.setState({ error: "" });
  try {
    const canDecode = "VideoDecoder" in window && "EncodedVideoChunk" in window;
    resetBuffers();
    useCaptureRuntimeStore.setState({ sourceMode: "scrcpy", running: true, sourceSize: { width: 0, height: 0 }, adbPreviewUrl: "" });
    startAgeTimer();
    if (canDecode) {
      await stopScrcpy().catch(() => {});
      await startScrcpyH264Decode();
      const result = await startScrcpy({ maxFps: 60, videoBitRate: 16000000, background: true, decoder: "h264" });
      if (!result?.status?.ok) throw new Error(result?.status?.message ?? "scrcpy did not start.");
    } else {
      const result = await startScrcpy({ maxFps: 60, videoBitRate: 16000000, background: true, decoder: "h264" });
      if (!result?.status?.ok) throw new Error(result?.status?.message ?? "scrcpy did not start.");
      runtime.adbActive = true;
      useCaptureRuntimeStore.setState({ error: "WebCodecs is unavailable in this browser, using ADB preview fallback." });
      void pollAdbFrame();
    }
  } catch (caught) {
    useCaptureRuntimeStore.setState({ error: caught instanceof Error ? caught.message : "Could not start scrcpy." });
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
  runtime.h264ReadyForKey = true;
  runtime.h264Configured = false;
  runtime.h264Decoder = new (window as any).VideoDecoder({
    output: drawDecodedFrame,
    error: (error: Error) => {
      useCaptureRuntimeStore.setState({ error: `H.264 decoder error: ${error.message}` });
    }
  });
  try {
    runtime.h264Decoder.configure({
      codec: "avc1.42E01F",
      optimizeForLatency: true,
      avc: { format: "annexb" }
    });
  } catch {
    runtime.h264Decoder.configure({ codec: "avc1.42E01F", optimizeForLatency: true });
  }
  runtime.h264Configured = true;

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws/capture/scrcpy-h264`);
  runtime.h264Socket = socket;
  socket.binaryType = "arraybuffer";
  const opened = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Timed out opening scrcpy H.264 WebSocket.")), 3000);
    socket.addEventListener("open", () => {
      window.clearTimeout(timer);
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
    decodeScrcpyPayload(new Uint8Array(event.data), meta);
  };
  socket.onerror = () => {
    useCaptureRuntimeStore.setState({ error: "scrcpy H.264 WebSocket failed; stop and restart capture if the phone stream changed." });
  };
  socket.onclose = () => {
    if (useCaptureRuntimeStore.getState().sourceMode === "scrcpy") useCaptureRuntimeStore.setState({ error: "scrcpy H.264 stream closed." });
  };
  return opened;
}

function handleScrcpyMessage(data: string) {
  try {
    const message = JSON.parse(data);
    if (message.type === "scrcpy_frame") runtime.h264PendingMeta.push(message);
    if (message.type === "scrcpy_stream_meta" && message.width && message.height) {
      useCaptureRuntimeStore.setState({ sourceSize: { width: Number(message.width), height: Number(message.height) } });
    }
    if (message.type === "scrcpy_error") useCaptureRuntimeStore.setState({ error: message.message ?? "scrcpy stream error." });
  } catch {}
}

function decodeScrcpyPayload(payload: Uint8Array, meta: ScrcpyFrameMeta) {
  if (!runtime.h264Decoder || !runtime.h264Configured) return;
  if (meta.config) {
    runtime.h264ConfigPayload = payload;
    return;
  }
  if (runtime.h264ReadyForKey && !meta.key) return;
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
    useCaptureRuntimeStore.setState({ error: caught instanceof Error ? caught.message : "Could not decode scrcpy H.264 frame." });
  }
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
  if (runtime.h264ReadyForKey && !key) return;
  runtime.h264ReadyForKey = false;
  try {
    runtime.h264Decoder?.decode(new (window as any).EncodedVideoChunk({
      type: key ? "key" : "delta",
      timestamp: Math.round(performance.now() * 1000),
      data
    }));
  } catch (caught) {
    runtime.h264ReadyForKey = true;
    useCaptureRuntimeStore.setState({ error: caught instanceof Error ? caught.message : "Could not decode raw scrcpy H.264 access unit." });
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
    useCaptureRuntimeStore.setState({ sourceSize: { width, height } });
  }
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
    useCaptureRuntimeStore.setState({ error: `${message}. Use ADB Native in this in-app browser, or open the app in Chrome/Edge for window capture.` });
  }
}

async function startAdbCapture() {
  useCaptureRuntimeStore.setState({ error: "" });
  resetBuffers();
  runtime.adbActive = true;
  useCaptureRuntimeStore.setState({ sourceMode: "adb", running: true });
  startAgeTimer();
  void pollAdbFrame();
}

function resetBuffers() {
  runtime.frameBuffer = [];
  runtime.nativeCropBuffer.splice(0).forEach((crop) => crop.bitmap.close());
  runtime.previous = emptyMetrics();
  runtime.frameTimes = [];
  useCaptureRuntimeStore.setState({ buffered: 0, nativeCrops: 0, fps: 0, lastFrameAge: null });
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
    useCaptureRuntimeStore.setState({ sourceSize: { width, height } });
  }
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
        useCaptureRuntimeStore.setState({ sourceSize: { width, height } });
      }
      canvas.getContext("2d", { willReadFrequently: true })?.drawImage(bitmap, 0, 0);
      analyzeCanvas(canvas, width, height);
    }
    bitmap.close();
  } catch (caught) {
    useCaptureRuntimeStore.setState({ error: caught instanceof Error ? caught.message : "ADB native frame capture failed." });
  } finally {
    if (!runtime.adbActive) return;
    runtime.adbTimer = window.setTimeout(() => void pollAdbFrame(), Math.max(120, 450 - (performance.now() - started)));
  }
}

function analyzeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const metrics = emptyMetrics();
  for (const region of regions) metrics[region.key] = sampleRegion(ctx, width, height, region, runtime.previous[region.key]);
  runtime.previous = metrics;

  const now = performance.now();
  runtime.frameBuffer.push({ time: now, sourceWidth: width, sourceHeight: height, regions: metrics });
  while (runtime.frameBuffer.length > maxBufferedFrames) runtime.frameBuffer.shift();
  queueNativeWindowCrops(canvas, width, height, now, metrics);

  runtime.frameTimes.push(now);
  while (runtime.frameTimes.length && now - runtime.frameTimes[0] > 1000) runtime.frameTimes.shift();

  useCaptureRuntimeStore.setState({
    metrics,
    buffered: runtime.frameBuffer.length,
    nativeCrops: runtime.nativeCropBuffer.length,
    fps: runtime.frameTimes.length,
    lastFrameAge: 0
  });
}

function sampleRegion(ctx: CanvasRenderingContext2D, width: number, height: number, region: Region, previous?: RegionMetrics): RegionMetrics {
  const [rx, ry, rw, rh] = region.rect;
  const x = Math.max(0, Math.floor(rx * width));
  const y = Math.max(0, Math.floor(ry * height));
  const w = Math.max(1, Math.floor(rw * width));
  const h = Math.max(1, Math.floor(rh * height));
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

function startAgeTimer() {
  if (runtime.ageTimer != null) window.clearInterval(runtime.ageTimer);
  runtime.ageTimer = window.setInterval(() => {
    const last = runtime.frameBuffer[runtime.frameBuffer.length - 1]?.time;
    useCaptureRuntimeStore.setState({ lastFrameAge: last ? performance.now() - last : null });
  }, 250);
}
