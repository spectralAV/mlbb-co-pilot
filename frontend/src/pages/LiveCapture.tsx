import { useEffect, useRef } from "react";
import { CircleStop, Database, Gauge, MonitorUp, ScanLine, Smartphone, Tv } from "lucide-react";
import {
  captureSources,
  maxBufferedFrames,
  maxNativeCrops,
  regions,
  startSelectedCaptureRuntime,
  stopCaptureRuntime,
  useCaptureRuntimeStore,
  type CaptureSource
} from "../runtime/captureRuntime";

export function LiveCapture() {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const {
    running,
    sourceMode,
    selectedSource,
    setSelectedSource,
    fps,
    buffered,
    nativeCrops,
    sourceSize,
    lastFrameAge,
    metrics,
    error,
    adbPreviewUrl,
    stream
  } = useCaptureRuntimeStore();

  useEffect(() => {
    if (!previewRef.current) return;
    previewRef.current.srcObject = sourceMode === "browser" ? stream : null;
    if (stream) void previewRef.current.play().catch(() => {});
  }, [stream, sourceMode]);

  const activeWindows = regions.filter((region) => metrics[region.key]?.active && region.key.includes("window"));
  const selected = captureSources.find((source) => source.id === selectedSource) ?? captureSources[0];
  const sourceAspect = sourceSize.width && sourceSize.height ? `${sourceSize.width} / ${sourceSize.height}` : "20 / 9";

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Live Capture</h2>
        <p className="text-slate-400">Unified runtime capture stays alive while you move between pages.</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        <button className="btn inline-flex items-center justify-center gap-2" onClick={startSelectedCaptureRuntime} disabled={running}><MonitorUp className="h-4 w-4" />Start</button>
        <button className="min-h-11 rounded-lg bg-white/10 px-4 py-2 font-semibold active:bg-white/20" onClick={stopCaptureRuntime} disabled={!running}><CircleStop className="mr-2 inline h-4 w-4" />Stop</button>
      </div>
    </div>

    {error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>}
    {running && <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
      Capture runtime is active globally. You can open Draft, Game, Map Trainer, or Settings without restarting capture.
    </div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {captureSources.map((source) => {
        const active = selectedSource === source.id;
        const Icon = source.id === "adb" ? Smartphone : source.id === "window" ? MonitorUp : source.id === "obs" || source.id === "ndi" || source.id === "capture_card" ? Tv : Database;
        return <button key={source.id} type="button" onClick={() => setSelectedSource(source.id as CaptureSource)} disabled={running} className={`min-h-32 rounded-lg border p-4 text-left transition active:scale-[0.99] ${active ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
          <div className="flex items-center justify-between gap-3">
            <Icon className={active ? "h-5 w-5 text-violet-200" : "h-5 w-5 text-cyan-300"} />
            <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${source.state === "ready" ? "bg-emerald-500/20 text-emerald-200" : source.state === "planned" ? "bg-cyan-500/20 text-cyan-100" : source.state === "optional" ? "bg-slate-500/25 text-slate-200" : "bg-amber-500/20 text-amber-100"}`}>{source.state}</span>
          </div>
          <div className="mt-3 font-black text-white">{source.title}</div>
          <p className="mt-2 text-sm text-slate-300">{source.detail}</p>
        </button>;
      })}
    </section>

    <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_360px]">
      <section className="card overflow-hidden">
        <div className="relative bg-black" style={{ aspectRatio: sourceAspect }}>
          {(sourceMode === "adb" || sourceMode === "scrcpy") && adbPreviewUrl ? <img src={adbPreviewUrl} alt="" className="h-full w-full object-contain" /> : <video ref={previewRef} muted playsInline className="h-full w-full object-contain" />}
          {regions.map((region) => {
            const [x, y, w, h] = region.rect;
            const active = metrics[region.key]?.active;
            return <div key={region.key} className={`pointer-events-none absolute border ${active ? "border-emerald-300 bg-emerald-400/10" : "border-sky-300/40 bg-sky-400/5"}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
              <span className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-emerald-400 text-slate-950" : "bg-black/60 text-sky-100"}`}>{region.label}</span>
            </div>;
          })}
          {!running && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-center text-sm text-slate-300"><div className="max-w-sm px-4">Selected: {selected.title}. Start once; the runtime will stay unified across app pages.</div></div>}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Gauge className="h-4 w-4 text-cyan-300" />Frame Pipeline</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Metric label="FPS" value={fps} />
            <Metric label="Buffer" value={`${buffered}/${maxBufferedFrames}`} />
            <Metric label="Latency" value={lastFrameAge == null ? "-" : `${Math.round(lastFrameAge)}ms`} />
            <Metric label="Mode" value={sourceMode === "adb" ? "ADB" : sourceMode === "scrcpy" ? "scrcpy" : running ? "Live" : "Idle"} />
            <Metric className="col-span-2" label="Native Source" value={sourceSize.width ? `${sourceSize.width}x${sourceSize.height}` : "-"} />
            <Metric className="col-span-2" label="Native ROI Crops" value={`${nativeCrops}/${maxNativeCrops}`} />
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
          <p className="mt-2 text-sm text-slate-300">Capture is now owned by the app shell instead of the current page. ADB still-frame capture, managed background scrcpy with native preview frames, draft recognition, map trainer, and overlay can consume the same runtime state.</p>
          <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-slate-300">{activeWindows.length ? `${activeWindows.map((item) => item.label).join(", ")} active in current frame.` : "No popup candidate in the current frame."}</div>
        </div>
      </aside>
    </div>
  </div>;
}

function Metric({ label, value, className = "" }: { label: string; value: string | number; className?: string }) {
  return <div className={`rounded-lg bg-white/5 p-3 ${className}`}><div className="text-slate-400">{label}</div><div className="text-2xl font-black">{value}</div></div>;
}
