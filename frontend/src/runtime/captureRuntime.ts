import { create } from "zustand";
import { startScrcpy, stopScrcpy } from "../api/client";

export type RegionKey = "equipment_window" | "attributes_window" | "scoreboard" | "minimap";
export type Region = { key: RegionKey; label: string; rect: [number, number, number, number] };
export type RegionMetrics = { mean: number; contrast: number; changed: number; active: boolean };
export type CaptureSource = "adb" | "window" | "scrcpy" | "ndi" | "capture_card" | "obs";
export type SourceMode = "idle" | "browser" | "adb" | "scrcpy";
type NativeCrop = { time: number; key: RegionKey; width: number; height: number; bitmap: ImageBitmap };
type FrameSummary = { time: number; sourceWidth: number; sourceHeight: number; regions: Record<RegionKey, RegionMetrics> };

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
  { id: "scrcpy", title: "Backend scrcpy", state: "ready", detail: "Managed native Android mirror through the local scrcpy binary." },
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
  adbPreviewUrl: "",
  adbTimer: null as number | null,
  adbActive: false,
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

export function stopCaptureRuntime() {
  if (runtime.raf != null) cancelAnimationFrame(runtime.raf);
  if (runtime.adbTimer != null) window.clearTimeout(runtime.adbTimer);
  if (runtime.ageTimer != null) window.clearInterval(runtime.ageTimer);
  runtime.raf = null;
  runtime.adbTimer = null;
  runtime.ageTimer = null;
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
    const result = await startScrcpy({ maxFps: 60, videoBitRate: "16M", background: true });
    if (!result?.status?.ok) throw new Error(result?.status?.message ?? "scrcpy did not start.");
    resetBuffers();
    useCaptureRuntimeStore.setState({ sourceMode: "scrcpy", running: true, sourceSize: { width: 0, height: 0 } });
  } catch (caught) {
    useCaptureRuntimeStore.setState({ error: caught instanceof Error ? caught.message : "Could not start scrcpy." });
  }
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
