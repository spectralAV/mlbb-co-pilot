import { useEffect, useRef, useState } from "react";
import { CircleStop, Crop, Database, Gauge, MonitorUp, Radio, RefreshCw, ScanLine, Smartphone, Tv } from "lucide-react";
import { getNativeObsVisionStatus, getNdiDirectSources, getNdiDirectStatus, getNdiToolsStatus, launchNdiTool } from "../api/client";
import {
  attachCapturePreviewCanvas,
  captureSources,
  maxBufferedFrames,
  maxNativeCrops,
  ndiDirectSourceStorageKey,
  ndiDirectSourceUrlStorageKey,
  regions,
  startSelectedCaptureRuntime,
  stopCaptureRuntime,
  useCaptureRuntimeStore,
  type CaptureSource,
  type ScrcpyVideoCodec
} from "../runtime/captureRuntime";

type NdiSource = { id: string; name: string; url?: string };

function storedValue(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) || fallback;
}

export function LiveCapture() {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const capturePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [nativeObsStatus, setNativeObsStatus] = useState<any>(null);
  const [ndiToolsStatus, setNdiToolsStatus] = useState<any>(null);
  const [directNdiSources, setDirectNdiSources] = useState<NdiSource[]>([]);
  const [selectedNdiSource, setSelectedNdiSource] = useState(() => storedValue(ndiDirectSourceStorageKey, ""));
  const [ndiDirectStatus, setNdiDirectStatus] = useState<any>(null);
  const [ndiDirectMessage, setNdiDirectMessage] = useState("Refresh direct NDI sources and select the phone source. This bypasses NDI Webcam.");
  const {
    running,
    sourceMode,
    selectedSource,
    selectedCodec,
    setSelectedSource,
    setSelectedCodec,
    fps,
    buffered,
    nativeCrops,
    sourceSize,
    lastFrameAge,
    metrics,
    liveVision,
    error,
    adbPreviewUrl,
    captureLog,
    stream,
    windowContentCrop,
    setWindowContentCrop
  } = useCaptureRuntimeStore();

  useEffect(() => {
    if (!previewRef.current) return;
    previewRef.current.srcObject = sourceMode === "browser" || sourceMode === "ndi" ? stream : null;
    if (stream) void previewRef.current.play().catch(() => {});
  }, [stream, sourceMode]);

  useEffect(() => () => attachCapturePreviewCanvas(null), []);

  useEffect(() => {
    if (selectedSource !== "obs" && sourceMode !== "obs") {
      setNativeObsStatus(null);
      return;
    }
    let active = true;
    async function refresh() {
      try {
        const result = await getNativeObsVisionStatus();
        if (active) setNativeObsStatus(result);
      } catch {
        if (active) setNativeObsStatus(null);
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedSource, sourceMode]);

  useEffect(() => {
    if (selectedSource !== "ndi") return;
    let active = true;
    async function refresh() {
      try {
        const [toolsStatus, directStatus] = await Promise.all([getNdiToolsStatus(), getNdiDirectStatus()]);
        if (active) {
          setNdiToolsStatus(toolsStatus);
          setNdiDirectStatus(directStatus);
        }
      } catch {
        if (active) {
          setNdiToolsStatus(null);
          setNdiDirectStatus(null);
        }
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedSource]);

  useEffect(() => {
    if (selectedSource !== "ndi") return;
    void refreshDirectNdiSources();
  }, [selectedSource]);

  const activeWindows = regions.filter((region) => metrics[region.key]?.active && region.key.includes("window"));
  const selected = captureSources.find((source) => source.id === selectedSource) ?? captureSources[0];
  const sourceAspect = sourceSize.width && sourceSize.height ? `${sourceSize.width} / ${sourceSize.height}` : "20 / 9";
  const codecOptions: Array<{ id: ScrcpyVideoCodec; label: string; detail: string }> = [
    { id: "h264", label: "H.264", detail: "Live WebCodecs path" },
    { id: "h265", label: "H.265", detail: "Preset only" },
    { id: "av1", label: "AV1", detail: "Preset only" }
  ];
  const selectedDirectNdiSource = directNdiSources.find((source) => source.name === selectedNdiSource || source.id === selectedNdiSource);
  const canStartSelected = !(selectedSource === "scrcpy" && selectedCodec !== "h264") && !(selectedSource === "ndi" && !selectedNdiSource);

  function rememberNdiSource(source: NdiSource | string) {
    const name = typeof source === "string" ? source : source.name;
    const url = typeof source === "string" ? "" : source.url ?? "";
    setSelectedNdiSource(name);
    window.localStorage.setItem(ndiDirectSourceStorageKey, name);
    if (url) window.localStorage.setItem(ndiDirectSourceUrlStorageKey, url);
    else window.localStorage.removeItem(ndiDirectSourceUrlStorageKey);
  }

  async function refreshDirectNdiSources() {
    try {
      const result = await getNdiDirectSources();
      const sources = result.sources ?? [];
      setDirectNdiSources(sources);
      if (!selectedNdiSource && sources[0]) rememberNdiSource(sources[0]);
      setNdiDirectMessage(sources.length
        ? `Found ${sources.length} direct NDI source${sources.length === 1 ? "" : "s"}. Start receives the source frames before NDI Webcam can crop them.`
        : "No direct NDI sources found yet. Keep NDI HX Capture open on the phone, then refresh.");
    } catch (error) {
      setNdiDirectMessage(error instanceof Error ? error.message : "Could not refresh direct NDI sources.");
    }
  }

  async function launchNdiStudioMonitor() {
    try {
      const result = await launchNdiTool("studioMonitor");
      setNdiToolsStatus(result.status);
      setNdiDirectMessage(result.ok ? "Studio Monitor launched for viewing only. Direct capture still uses the selected NDI source." : result.error ?? "Could not launch Studio Monitor.");
    } catch (error) {
      setNdiDirectMessage(error instanceof Error ? error.message : "Could not launch Studio Monitor.");
    }
  }

  return <div className="live-capture-page">
    <div className="live-capture-header">
      <div>
        <h2>Live Capture</h2>
        <p>Unified runtime capture stays alive while you move between pages.</p>
      </div>
      <div className="live-capture-actions">
        <button className="btn inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={startSelectedCaptureRuntime} disabled={running || !canStartSelected}><MonitorUp className="h-4 w-4" />Start</button>
        <button className="capture-secondary-button" onClick={stopCaptureRuntime} disabled={!running}><CircleStop className="h-4 w-4" />Stop</button>
      </div>
    </div>

    {error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>}
    {running && <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
      Capture runtime is active globally. You can open Draft, Calibration, Stream Output, or Settings without restarting capture.
    </div>}

    <section className="capture-source-grid">
      {captureSources.map((source) => {
        const active = selectedSource === source.id;
        const Icon = source.id === "adb" ? Smartphone : source.id === "window" ? MonitorUp : source.id === "obs" || source.id === "ndi" || source.id === "capture_card" ? Tv : Database;
        return <button key={source.id} type="button" onClick={() => setSelectedSource(source.id as CaptureSource)} disabled={running} className={`capture-source-card ${active ? "capture-source-card-active" : ""}`}>
          <div className="flex items-center justify-between gap-3">
            <Icon className={active ? "h-5 w-5 text-violet-200" : "h-5 w-5 text-cyan-300"} />
            <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${source.state === "ready" ? "bg-emerald-500/20 text-emerald-200" : source.state === "planned" ? "bg-cyan-500/20 text-cyan-100" : source.state === "optional" ? "bg-slate-500/25 text-slate-200" : "bg-amber-500/20 text-amber-100"}`}>{source.state}</span>
          </div>
          <div className="capture-source-title">{source.title}</div>
          <p>{source.detail}</p>
        </button>;
      })}
    </section>

    {selectedSource === "scrcpy" && <section className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold">Scrcpy Codec</h3>
          <p className="text-sm text-slate-400">Switch codecs before starting capture. H.264 is the active low-latency browser preview path; H.265 and AV1 are saved presets until backend decode is wired.</p>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
          {codecOptions.map((codec) => {
            const active = selectedCodec === codec.id;
            return <button key={codec.id} type="button" disabled={running} onClick={() => setSelectedCodec(codec.id)} className={`min-h-12 rounded-lg border px-3 py-2 text-left transition active:scale-[0.99] ${active ? "border-cyan-300 bg-cyan-400/15 text-white" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>
              <div className="text-sm font-black">{codec.label}</div>
              <div className="text-[11px] text-slate-400">{codec.detail}</div>
            </button>;
          })}
        </div>
      </div>
    </section>}

    {selectedSource === "scrcpy" && selectedCodec !== "h264" && <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
      {selectedCodec.toUpperCase()} is selectable for device/encoder testing, but live preview and CV are disabled for it right now so the app does not fall into the slow ADB frame path.
    </div>}

    {selectedSource === "ndi" && <section className="card capture-ndi-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h3 className="flex items-center gap-2 font-bold"><Radio className="h-4 w-4 text-cyan-300" />Direct NDI Source</h3>
          <p className="mt-1 text-sm text-slate-400">Receives the phone's NDI stream directly through the NDI SDK. No NDI Webcam, no camera wrapper, no extra crop.</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${ndiToolsStatus?.installed ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-100"}`}>
          {ndiToolsStatus?.installed ? "NDI Tools found" : "Checking tools"}
        </span>
      </div>

      <div className="mt-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-white">Windows NDI 6 Tools</div>
              <div className="mt-1 text-xs text-slate-400">{ndiToolsStatus?.toolsRoot ?? "C:\\Program Files\\NDI\\NDI 6 Tools"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="cv-ghost-button inline-flex min-h-10 items-center gap-2 px-3 text-xs" onClick={() => void refreshDirectNdiSources()}>
                <RefreshCw className="h-4 w-4" />Refresh Sources
              </button>
              <button className="cv-ghost-button inline-flex min-h-10 items-center gap-2 px-3 text-xs" disabled={!ndiToolsStatus?.tools?.studioMonitor?.available} onClick={() => void launchNdiStudioMonitor()}>
                <MonitorUp className="h-4 w-4" />Open Studio Monitor
              </button>
              <button className="cv-ghost-button inline-flex min-h-10 items-center gap-2 px-3 text-xs" disabled={!ndiToolsStatus?.tools?.testPatterns?.available} onClick={() => void launchNdiTool("testPatterns")}>
                <RefreshCw className="h-4 w-4" />Test Pattern
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <Metric label="Runtime" value={ndiToolsStatus?.runtimeAvailable ? "NDI 6" : "Missing"} />
            <Metric label="Direct Receiver" value={ndiDirectStatus?.running ? "Running" : "Ready"} />
            <Metric label="Source Frames" value={ndiDirectStatus?.frames ?? 0} />
            <Metric label="Source Size" value={ndiDirectStatus?.width ? `${ndiDirectStatus.width}x${ndiDirectStatus.height}` : "-"} />
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
            <select className="input min-h-10 min-w-0 py-1 text-sm" value={selectedNdiSource} onChange={(event) => {
              const source = directNdiSources.find((item) => item.name === event.target.value || item.id === event.target.value);
              rememberNdiSource(source ?? event.target.value);
            }}>
              <option value="">Select direct NDI source</option>
              {directNdiSources.map((source) => <option key={source.id || source.name} value={source.name}>{source.name}{source.url ? ` - ${source.url}` : ""}</option>)}
            </select>
            <div className="capture-metric min-h-10 min-w-44">
              <div>Selected</div>
              <strong>{selectedDirectNdiSource?.name || selectedNdiSource || "None"}</strong>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-500/10 p-3 text-sm text-cyan-50">
            {ndiDirectMessage}
          </div>
        </div>
      </div>
    </section>}

    {selectedSource === "window" && <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold"><Crop className="h-4 w-4 text-cyan-300" />Window Content Crop</h3>
          <p className="mt-1 text-sm text-slate-400">{windowContentCrop.enabled ? "Applied to preview and CV" : "Full captured window"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-semibold">
            <input type="checkbox" checked={windowContentCrop.enabled} onChange={(event) => setWindowContentCrop({ enabled: event.target.checked })} />
            Crop
          </label>
          <button className="min-h-10 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 text-sm font-semibold text-cyan-100" onClick={() => setWindowContentCrop({ enabled: true, top: 0.13, bottom: 0.06, left: 0, right: 0 })}>Stream Pop-out</button>
          <button className="min-h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-semibold" onClick={() => setWindowContentCrop({ enabled: false, top: 0, bottom: 0, left: 0, right: 0 })}>Full Frame</button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {(["top", "bottom", "left", "right"] as const).map((edge) => <label key={edge} className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-slate-400">
            <span>{edge}</span>
            <span>{Math.round(windowContentCrop[edge] * 100)}%</span>
          </div>
          <input className="mt-3 w-full accent-cyan-300" type="range" min="0" max="30" step="1" value={Math.round(windowContentCrop[edge] * 100)} onChange={(event) => setWindowContentCrop({ enabled: true, [edge]: Number(event.target.value) / 100 })} />
        </label>)}
      </div>
    </section>}

    <div className="capture-workspace">
      <section className="card overflow-hidden">
        <div className="capture-preview-stage" style={{ aspectRatio: sourceAspect }}>
          {sourceMode === "scrcpy" || sourceMode === "browser" ? <canvas ref={(node) => { capturePreviewCanvasRef.current = node; attachCapturePreviewCanvas(node); }} className="h-full w-full object-contain" /> : (sourceMode === "adb" || sourceMode === "obs" || sourceMode === "ndi") && adbPreviewUrl ? <img src={adbPreviewUrl} alt="" className="h-full w-full object-contain" /> : <video ref={previewRef} muted playsInline className="h-full w-full object-contain" />}
          {regions.map((region) => {
            const [x, y, w, h] = region.rect;
            const active = metrics[region.key]?.active;
            return <div key={region.key} className={`pointer-events-none absolute border ${active ? "border-emerald-300 bg-emerald-400/10" : "border-sky-300/40 bg-sky-400/5"}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
              <span className={`capture-roi-label ${active ? "capture-roi-label-active" : ""}`}>{region.label}</span>
            </div>;
          })}
          {!running && <div className="capture-preview-empty"><div>Selected: {selected.title}. Start once; the runtime will stay unified across app pages.</div></div>}
        </div>
      </section>

      <aside className="capture-side-stack">
        <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Gauge className="h-4 w-4 text-cyan-300" />Frame Pipeline</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Metric label="FPS" value={fps} />
            <Metric label="Buffer" value={`${buffered}/${maxBufferedFrames}`} />
            <Metric label="Latency" value={lastFrameAge == null ? "-" : `${Math.round(lastFrameAge)}ms`} />
            <Metric label="Mode" value={sourceMode === "adb" ? "ADB" : sourceMode === "scrcpy" ? "scrcpy" : sourceMode === "ndi" ? "Direct NDI" : sourceMode === "obs" ? "OBS bridge" : running ? "Live" : "Idle"} />
            <Metric className="col-span-2" label="Codec" value={selectedSource === "scrcpy" ? selectedCodec.toUpperCase() : sourceMode === "ndi" ? "NDI SDK frame" : selectedSource === "obs" ? "Native decoded" : "-"} />
            <Metric className="col-span-2" label={sourceMode === "browser" ? "CV Surface" : sourceMode === "ndi" ? "Direct Source" : "Native Source"} value={sourceSize.width ? `${sourceSize.width}x${sourceSize.height}` : "-"} />
            <Metric className="col-span-2" label="Native ROI Crops" value={`${nativeCrops}/${maxNativeCrops}`} />
          </div>
        </div>

        {selectedSource === "obs" && <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Database className="h-4 w-4 text-cyan-300" />Native OBS Ultralytics</h3>
          <p className="mt-2 text-sm text-slate-300">Frames pass from the OBS plugin straight to the backend inference worker. This panel only monitors it.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Metric label="Bridge" value={nativeObsStatus?.bridge?.connected ? "Live" : "Waiting"} />
            <Metric label="Model" value={nativeObsStatus?.ultralytics?.modelAvailable ? "Loaded" : "No weights"} />
            <Metric label="Queued" value={nativeObsStatus?.ultralytics?.queuedFrames ?? 0} />
            <Metric label="Processed" value={nativeObsStatus?.ultralytics?.processedFrames ?? 0} />
            <Metric label="Dropped stale" value={nativeObsStatus?.ultralytics?.droppedFrames ?? 0} />
            <Metric label="Inference" value={nativeObsStatus?.ultralytics?.lastLatencyMs == null ? "-" : `${nativeObsStatus.ultralytics.lastLatencyMs}ms`} />
          </div>
        </div>}

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
          <h3 className="flex items-center gap-2 font-bold"><ScanLine className="h-4 w-4 text-cyan-300" />Screen Classifier</h3>
          {liveVision ? <>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-cyan-300/25 bg-cyan-500/10 p-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Detected state</div>
                <div className="mt-1 text-lg font-black uppercase text-cyan-100">{liveVision.screen.replace(/_/g, " ")}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-white">{Math.round(liveVision.confidence * 100)}%</div>
                <div className="text-xs font-bold uppercase text-slate-400">{liveVision.directorScene ?? "main"} overlay</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-sm text-slate-300">
              {liveVision.evidence.map((line) => <div key={line}>- {line}</div>)}
            </div>
            {liveVision.signals?.allyEquipment?.length ? <div className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-500/5 p-3">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Confirmed Ally Equipment</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {liveVision.signals.allyEquipment.map((item) => (
                  <span key={`${item.row}-${item.slot}`} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100">
                    {item.itemName} <span className="text-slate-400">R{item.row}.{item.slot} {Math.round(item.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
            </div> : null}
            {liveVision.signals?.enemyEquipment?.length ? <div className="mt-3 rounded-lg border border-rose-300/20 bg-rose-500/5 p-3">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-200">Confirmed Enemy Equipment</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {liveVision.signals.enemyEquipment.map((item) => (
                  <span key={`${item.row}-${item.slot}`} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100">
                    {item.itemName} <span className="text-slate-400">R{item.row}.{item.slot} {Math.round(item.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
            </div> : null}
            {liveVision.signals?.yoloDetections?.length ? <div className="mt-3 rounded-lg border border-violet-300/20 bg-violet-500/5 p-3">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Ultralytics Visible Facts</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {liveVision.signals.yoloDetections.map((fact, index) => (
                  <span key={`${fact.className}-${index}`} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100">
                    {fact.className.replace(/_/g, " ")} <span className="text-slate-400">{Math.round(fact.confidence * 100)}%</span>
                  </span>
                ))}
              </div>
            </div> : null}
          </> : <p className="mt-3 text-sm text-slate-400">Start capture to emit screen-state snapshots for the live overlay director.</p>}
        </div>

        <div className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Database className="h-4 w-4 text-cyan-300" />Runtime Design</h3>
          <p className="mt-2 text-sm text-slate-300">OBS plugin frames now feed backend Ultralytics directly, even when this page is closed. This preview still runs the browser-based draft and popup detectors until those are migrated behind the same native bridge.</p>
          <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-slate-300">{activeWindows.length ? `${activeWindows.map((item) => item.label).join(", ")} active in current frame.` : "No popup candidate in the current frame."}</div>
        </div>

        <div className="card p-4">
          <h3 className="font-bold">Capture Log</h3>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto text-xs">
            {captureLog.length ? captureLog.slice(-10).reverse().map((entry) => (
              <div key={`${entry.time}-${entry.message}`} className={`rounded-lg border px-3 py-2 ${entry.level === "error" ? "border-red-400/30 bg-red-500/10 text-red-100" : entry.level === "warn" ? "border-amber-300/30 bg-amber-500/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}>
                <span className="mr-2 text-slate-500">{new Date(entry.time).toLocaleTimeString()}</span>
                {entry.message}
              </div>
            )) : <div className="rounded-lg bg-white/5 p-3 text-slate-400">No capture events yet.</div>}
          </div>
        </div>
      </aside>
    </div>
  </div>;
}

function Metric({ label, value, className = "" }: { label: string; value: string | number; className?: string }) {
  return <div className={`capture-metric ${className}`}><div>{label}</div><strong>{value}</strong></div>;
}
