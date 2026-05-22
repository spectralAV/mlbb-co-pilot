import { useEffect, useRef, useState } from "react";
import { CircleStop, Database, Gauge, MonitorUp, ScanLine } from "lucide-react";

type RegionKey = "equipment_window" | "attributes_window" | "scoreboard" | "minimap";
type Region = { key: RegionKey; label: string; rect: [number, number, number, number] };
type RegionMetrics = { mean: number; contrast: number; changed: number; active: boolean };
type NativeCrop = { time: number; key: RegionKey; width: number; height: number; bitmap: ImageBitmap };
type FrameSummary = { time: number; sourceWidth: number; sourceHeight: number; regions: Record<RegionKey, RegionMetrics> };

const regions: Region[] = [
  { key: "equipment_window", label: "Equipment Window", rect: [0.58, 0.08, 0.38, 0.78] },
  { key: "attributes_window", label: "Attributes Window", rect: [0.42, 0.08, 0.54, 0.78] },
  { key: "scoreboard", label: "Top HUD", rect: [0.32, 0, 0.36, 0.08] },
  { key: "minimap", label: "Minimap", rect: [0.01, 0.02, 0.17, 0.28] }
];

const maxBufferedFrames = 180;
const maxNativeCrops = 96;

function emptyMetrics(): Record<RegionKey, RegionMetrics> {
  return {
    equipment_window: { mean: 0, contrast: 0, changed: 0, active: false },
    attributes_window: { mean: 0, contrast: 0, changed: 0, active: false },
    scoreboard: { mean: 0, contrast: 0, changed: 0, active: false },
    minimap: { mean: 0, contrast: 0, changed: 0, active: false }
  };
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

export function LiveCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameBufferRef = useRef<FrameSummary[]>([]);
  const nativeCropBufferRef = useRef<NativeCrop[]>([]);
  const previousRef = useRef<Record<RegionKey, RegionMetrics>>(emptyMetrics());
  const frameTimesRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [nativeCrops, setNativeCrops] = useState(0);
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [lastFrameAge, setLastFrameAge] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Record<RegionKey, RegionMetrics>>(emptyMetrics());
  const [error, setError] = useState("");

  useEffect(() => () => stopCapture(), []);

  function stopCapture() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    nativeCropBufferRef.current.splice(0).forEach((crop) => crop.bitmap.close());
    setNativeCrops(0);
    setRunning(false);
  }

  async function startCapture() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      frameBufferRef.current = [];
      nativeCropBufferRef.current.splice(0).forEach((crop) => crop.bitmap.close());
      previousRef.current = emptyMetrics();
      frameTimesRef.current = [];
      setRunning(true);
      scheduleFrame();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start screen capture.");
    }
  }

  function scheduleFrame() {
    const video = videoRef.current as any;
    if (video?.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(() => {
        processFrame();
        scheduleFrame();
      });
    } else {
      rafRef.current = requestAnimationFrame(() => {
        processFrame();
        scheduleFrame();
      });
    }
  }

  function processFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      setSourceSize({ width, height });
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const next = emptyMetrics();
    for (const region of regions) next[region.key] = sampleRegion(ctx, width, height, region, previousRef.current[region.key]);
    previousRef.current = next;

    const now = performance.now();
    const buffer = frameBufferRef.current;
    buffer.push({ time: now, sourceWidth: width, sourceHeight: height, regions: next });
    while (buffer.length > maxBufferedFrames) buffer.shift();
    queueNativeWindowCrops(canvas, width, height, now, next);

    const frameTimes = frameTimesRef.current;
    frameTimes.push(now);
    while (frameTimes.length && now - frameTimes[0] > 1000) frameTimes.shift();

    setMetrics(next);
    setBuffered(buffer.length);
    setNativeCrops(nativeCropBufferRef.current.length);
    setFps(frameTimes.length);
    setLastFrameAge(0);
  }

  function queueNativeWindowCrops(canvas: HTMLCanvasElement, width: number, height: number, time: number, next: Record<RegionKey, RegionMetrics>) {
    for (const region of regions) {
      if (!region.key.includes("window")) continue;
      const metrics = next[region.key];
      if (!metrics.active && metrics.changed < 5) continue;
      const [rx, ry, rw, rh] = region.rect;
      const x = Math.max(0, Math.floor(rx * width));
      const y = Math.max(0, Math.floor(ry * height));
      const w = Math.max(1, Math.floor(rw * width));
      const h = Math.max(1, Math.floor(rh * height));
      void createImageBitmap(canvas, x, y, w, h).then((bitmap) => {
        const crops = nativeCropBufferRef.current;
        crops.push({ time, key: region.key, width: w, height: h, bitmap });
        while (crops.length > maxNativeCrops) crops.shift()?.bitmap.close();
        setNativeCrops(crops.length);
      }).catch(() => {});
    }
  }

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const last = frameBufferRef.current.at(-1)?.time;
      setLastFrameAge(last ? performance.now() - last : null);
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const activeWindows = regions.filter((region) => metrics[region.key]?.active && region.key.includes("window"));

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Live Capture</h2>
        <p className="text-slate-400">Realtime screen/window capture with a rolling frame buffer for short MLBB equipment and attributes popups.</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <button className="btn inline-flex items-center justify-center gap-2" onClick={startCapture} disabled={running}><MonitorUp className="h-4 w-4" />Start</button>
        <button className="min-h-11 rounded-lg bg-white/10 px-4 py-2 font-semibold active:bg-white/20" onClick={stopCapture} disabled={!running}><CircleStop className="mr-2 inline h-4 w-4" />Stop</button>
      </div>
    </div>

    {error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>}

    <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_360px]">
      <section className="card overflow-hidden">
        <div className="relative aspect-[20/9] bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          {regions.map((region) => {
            const [x, y, w, h] = region.rect;
            const active = metrics[region.key]?.active;
            return <div key={region.key} className={`pointer-events-none absolute border ${active ? "border-emerald-300 bg-emerald-400/10" : "border-sky-300/40 bg-sky-400/5"}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
              <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-emerald-400 text-slate-950" : "bg-black/60 text-sky-100"}`}>{region.label}</span>
            </div>;
          })}
          {!running && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-center text-sm text-slate-300"><div className="max-w-sm px-4">Start capture and choose the scrcpy or OBS window. The app samples video frames locally in this browser tab.</div></div>}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Gauge className="h-4 w-4 text-cyan-300" />Frame Pipeline</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-white/5 p-3"><div className="text-slate-400">FPS</div><div className="text-2xl font-black">{fps}</div></div>
            <div className="rounded-lg bg-white/5 p-3"><div className="text-slate-400">Buffer</div><div className="text-2xl font-black">{buffered}/{maxBufferedFrames}</div></div>
            <div className="rounded-lg bg-white/5 p-3"><div className="text-slate-400">Latency</div><div className="text-2xl font-black">{lastFrameAge == null ? "-" : `${Math.round(lastFrameAge)}ms`}</div></div>
            <div className="rounded-lg bg-white/5 p-3"><div className="text-slate-400">Mode</div><div className="text-2xl font-black">{running ? "Live" : "Idle"}</div></div>
            <div className="col-span-2 rounded-lg bg-white/5 p-3"><div className="text-slate-400">Native Source</div><div className="text-2xl font-black">{sourceSize.width ? `${sourceSize.width}x${sourceSize.height}` : "-"}</div></div>
            <div className="col-span-2 rounded-lg bg-white/5 p-3"><div className="text-slate-400">Native ROI Crops</div><div className="text-2xl font-black">{nativeCrops}/{maxNativeCrops}</div></div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><ScanLine className="h-4 w-4 text-cyan-300" />Fast Popup ROIs</h3>
          <div className="mt-3 space-y-2">
            {regions.filter((region) => region.key.includes("window")).map((region) => {
              const item = metrics[region.key];
              return <div key={region.key} className={`rounded-lg border p-3 ${item.active ? "border-emerald-300/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
                <div className="flex items-center justify-between gap-3"><span className="font-semibold">{region.label}</span><span className="text-xs text-slate-300">{item.active ? "candidate" : "watching"}</span></div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-300">
                  <span>mean {item.mean.toFixed(1)}</span>
                  <span>contrast {item.contrast.toFixed(1)}</span>
                  <span>change {item.changed.toFixed(1)}</span>
                </div>
              </div>;
            })}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Database className="h-4 w-4 text-cyan-300" />Runtime Design</h3>
          <p className="mt-2 text-sm text-slate-300">Use browser/OBS video frames for realtime CV. Frames and ROI crops stay at native source resolution; ADB screenshots stay for manual samples only.</p>
          <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-slate-300">{activeWindows.length ? `${activeWindows.map((item) => item.label).join(", ")} active in current frame.` : "No popup candidate in the current frame."}</div>
        </div>
      </aside>
    </div>

    <canvas ref={canvasRef} className="hidden" data-source-size={`${sourceSize.width}x${sourceSize.height}`} />
  </div>;
}
