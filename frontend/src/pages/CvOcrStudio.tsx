import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileUp, Radio, RefreshCw, RotateCcw, Save, ScanText, Trash2, Wand2 } from "lucide-react";
import {
  apiUrl,
  getMlbbHudOcrFeedLatest,
  getObsRegions,
  getScreenOcrStatus,
  inferScreenOcrFrame,
  installScreenOcrRuntime,
  saveObsRegions,
} from "../api/client";
import { captureCurrentRuntimeFrame, captureSources, useCaptureRuntimeStore } from "../runtime/captureRuntime";
import { normalizeReviewRect, type NormalizedRect } from "../utils/cvGeometry";

type Rect = NormalizedRect;
type OcrMode = "gold" | "number" | "timer" | "text";
type OcrRegion = { id: string; key: string; rect: Rect; mode: OcrMode; value?: string; confidence?: number };
type ScreenOcrFact = {
  region: string;
  text: string;
  confidence: number;
  rect: Rect;
  words?: Array<{ text: string; confidence: number }>;
};
type DrawState = { start: { x: number; y: number }; current: { x: number; y: number } };

const fallbackMlbbRegions = [
  { key: "turret1", rect: fromPixels(665, 12, 34, 36), mode: "number" },
  { key: "lord1", rect: fromPixels(580, 12, 34, 39), mode: "number" },
  { key: "gold1", rect: fromPixels(743, 12, 75, 38), mode: "gold" },
  { key: "killscore1", rect: fromPixels(848, 6, 51, 43), mode: "number" },
  { key: "timer", rect: fromPixels(921, 7, 80, 40), mode: "timer" },
  { key: "killscore2", rect: fromPixels(1022, 7, 49, 42), mode: "number" },
  { key: "gold2", rect: fromPixels(1137, 12, 68, 36), mode: "gold" },
  { key: "turret2", rect: fromPixels(1251, 11, 32, 36), mode: "number" },
  { key: "lord2", rect: fromPixels(1329, 12, 40, 36), mode: "number" },
] satisfies Array<{ key: string; rect: Rect; mode: OcrMode }>;

export function CvOcrStudio() {
  const fileRef = useRef<HTMLInputElement>(null);
  const running = useCaptureRuntimeStore((state) => state.running);
  const selectedSource = useCaptureRuntimeStore((state) => state.selectedSource);
  const sourceMode = useCaptureRuntimeStore((state) => state.sourceMode);
  const [status, setStatus] = useState<any>(null);
  const [regions, setRegions] = useState<OcrRegion[]>(() => toOcrRegions(fallbackMlbbRegions));
  const [selectedId, setSelectedId] = useState(fallbackMlbbRegions[0].key);
  const [edited, setEdited] = useState(false);
  const [frame, setFrame] = useState<Blob | null>(null);
  const [frameUrl, setFrameUrl] = useState("");
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [frameLabel, setFrameLabel] = useState("No frame loaded");
  const [results, setResults] = useState<ScreenOcrFact[]>([]);
  const [drawing, setDrawing] = useState<DrawState | null>(null);
  const [feedSource, setFeedSource] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("MLBB HUD OCR preset is ready. Capture or import a gameplay frame to calibrate it.");

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
  }, [frameUrl]);

  const selectedRegion = useMemo(() => regions.find((region) => region.id === selectedId) ?? regions[0], [regions, selectedId]);
  const sourceLabel = captureSources.find((source) => source.id === selectedSource)?.title ?? selectedSource;
  const liveJson = useMemo(() => {
    const entries = regions.map((region) => [region.key, region.value ?? ""]);
    return Object.fromEntries(entries) as Record<string, string>;
  }, [regions]);
  const draftRect = drawing ? rectFromPoints(drawing.start, drawing.current) : null;
  const ocrReady = status?.packageAvailable || status?.paddleAvailable;

  async function refreshStatus() {
    setBusy("status");
    try {
      const result = await getScreenOcrStatus();
      const data = result.data ?? result;
      setStatus(data);
      if (!edited && Array.isArray(data?.mlbbHudRegions) && data.mlbbHudRegions.length) {
        const next = toOcrRegions(data.mlbbHudRegions);
        setRegions(next);
        setSelectedId(next[0]?.id ?? "");
      }
      setMessage(data?.packageAvailable ? "Screen OCR runtime is ready." : "Screen OCR runtime is not installed yet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Screen OCR status is unavailable.");
    } finally {
      setBusy("");
    }
  }

  async function installRuntime() {
    setBusy("install");
    setMessage("Installing screen OCR runtime.");
    try {
      await installScreenOcrRuntime();
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Screen OCR installation failed.");
    } finally {
      setBusy("");
    }
  }

  async function loadFrameBlob(blob: Blob, label: string) {
    const bitmap = await createImageBitmap(blob);
    const nextUrl = URL.createObjectURL(blob);
    setFrame(blob);
    setFrameUrl(nextUrl);
    setFrameSize({ width: bitmap.width, height: bitmap.height });
    setFrameLabel(label);
    setResults([]);
    setRegions((items) => items.map((item) => ({ ...item, value: undefined, confidence: undefined })));
    bitmap.close();
  }

  async function captureFrame() {
    setBusy("capture");
    try {
      const captured = await captureCurrentRuntimeFrame();
      if (captured) {
        await loadFrameBlob(captured.blob, `${captured.source.toUpperCase()} ${captured.width}x${captured.height}`);
        setMessage("Captured the current runtime frame.");
        return;
      }
      if (selectedSource === "obs") {
        const response = await fetch(apiUrl(`/api/capture/obs/frame?t=${Date.now()}`), { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        await loadFrameBlob(await response.blob(), "OBS bridge frame");
        setMessage("Captured the latest OBS bridge frame.");
        return;
      }
      if (selectedSource === "adb") {
        const response = await fetch(apiUrl(`/api/capture/frame?t=${Date.now()}`), { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        await loadFrameBlob(await response.blob(), "ADB still frame");
        setMessage("Captured an ADB still frame.");
        return;
      }
      throw new Error("No active runtime frame is available. Start capture, use OBS/ADB, or import a frame.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Frame capture failed.");
    } finally {
      setBusy("");
    }
  }

  async function importFrame(file: File) {
    setBusy("import");
    try {
      await loadFrameBlob(file, file.name);
      setMessage("Imported frame for HUD OCR calibration.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Frame import failed.");
    } finally {
      setBusy("");
    }
  }

  async function runOcr() {
    if (!frame) {
      setMessage("Load a frame before running OCR.");
      return;
    }
    setBusy("ocr");
    try {
      const result = await inferScreenOcrFrame(frame, {
        profile: "mlbb-hud",
        regions: regions.map(({ key, rect }) => ({ key, rect })),
        maxRegions: regions.length,
      });
      const facts = (result.data?.regions ?? result.regions ?? []) as ScreenOcrFact[];
      const factMap = new Map(facts.map((fact) => [fact.region, fact]));
      setResults(facts);
      setRegions((items) => items.map((item) => {
        const fact = factMap.get(item.key);
        return fact ? { ...item, value: fact.text, confidence: fact.confidence } : { ...item, value: "", confidence: 0 };
      }));
      setMessage(`OCR read ${facts.filter((fact) => fact.text).length}/${regions.length} HUD fields.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HUD OCR failed.");
    } finally {
      setBusy("");
    }
  }

  async function readMlbbHudFeed() {
    setBusy("feed");
    try {
      const result = await getMlbbHudOcrFeedLatest(feedQueryParams(feedSource));
      const data = result.data ?? result;
      if (!data?.connected) {
        const candidates = Array.isArray(data?.candidates) ? data.candidates.slice(0, 4).join(", ") : "";
        throw new Error(candidates ? `${data?.error ?? "MLBB HUD OCR feed is not available."} Tried ${candidates}.` : data?.error ?? "MLBB HUD OCR feed is not available.");
      }
      const fields = data.fields ?? {};
      setRegions((items) => items.map((item) => {
        const value = fields[item.key];
        return value == null ? item : { ...item, value: String(value), confidence: String(value) ? 1 : 0 };
      }));
      setMessage(`Read MLBB HUD OCR feed from ${data.url}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MLBB HUD OCR feed failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveCalibration() {
    setBusy("save");
    try {
      const currentResponse = await getObsRegions().catch(() => null);
      const current = currentResponse?.regions ?? currentResponse ?? {};
      const payload: Record<string, Rect[]> = {};
      for (const region of regions) payload[calibrationKey(region.key)] = [region.rect];
      const scoreboard = unionRect(regions.map((region) => region.rect));
      if (scoreboard) payload.scoreboard_norm = [scoreboard];
      await saveObsRegions({ ...current, ...payload });
      setEdited(false);
      setMessage(`Saved ${regions.length} MLBB HUD OCR regions as normalized calibration.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calibration save failed.");
    } finally {
      setBusy("");
    }
  }

  function resetPreset() {
    const next = toOcrRegions(status?.mlbbHudRegions?.length ? status.mlbbHudRegions : fallbackMlbbRegions);
    setRegions(next);
    setSelectedId(next[0]?.id ?? "");
    setResults([]);
    setEdited(true);
    setMessage("Reset to the MLBB HUD OCR preset.");
  }

  function addRegion() {
    const id = `region_${regions.length + 1}`;
    const next: OcrRegion = { id, key: id, rect: [0.45, 0.08, 0.08, 0.04], mode: "text" };
    setRegions((items) => [...items, next]);
    setSelectedId(id);
    setEdited(true);
  }

  function deleteSelectedRegion() {
    if (!selectedRegion) return;
    const next = regions.filter((region) => region.id !== selectedRegion.id);
    setRegions(next);
    setSelectedId(next[0]?.id ?? "");
    setEdited(true);
  }

  function updateSelected(patch: Partial<OcrRegion>) {
    if (!selectedRegion) return;
    setRegions((items) => items.map((item) => item.id === selectedRegion.id ? { ...item, ...patch } : item));
    setEdited(true);
  }

  function updateSelectedRect(index: number, value: number) {
    if (!selectedRegion) return;
    const rect = [...selectedRegion.rect] as Rect;
    rect[index] = clamp(Number(value), 0, 1);
    const normalized = normalizeReviewRect(rect);
    if (!normalized) return;
    updateSelected({ rect: normalized });
  }

  function stagePoint(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }

  function startDraw(event: PointerEvent<HTMLDivElement>) {
    if (!frameUrl || busy) return;
    const point = stagePoint(event);
    setDrawing({ start: point, current: point });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDraw(event: PointerEvent<HTMLDivElement>) {
    if (!drawing) return;
    setDrawing({ ...drawing, current: stagePoint(event) });
  }

  function finishDraw(event: PointerEvent<HTMLDivElement>) {
    if (!drawing) return;
    const rect = rectFromPoints(drawing.start, stagePoint(event));
    setDrawing(null);
    if (!rect) return;
    if (selectedRegion) updateSelected({ rect });
    else addRegion();
  }

  return <div className="cv-tool-embedded">
    <input ref={fileRef} className="hidden" type="file" accept="image/*" onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) void importFrame(file);
      event.currentTarget.value = "";
    }} />

    <section className="cv-tool-toolbar">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2"><ScanText size={18} className="text-cyan-300" />HUD OCR Editor</h3>
        <p className="text-slate-400">FalseOCR-style MLBB scoreboard regions, normalized calibration, and OCR cleanup inside CV Studio.</p>
      </div>
      <div className="cv-tool-actions">
        <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void captureFrame()}><Camera size={15} />Capture</button>
        <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><FileUp size={15} />Import</button>
        <button className="btn inline-flex items-center gap-2" disabled={Boolean(busy) || !frame} onClick={() => void runOcr()}><Wand2 size={16} />{busy === "ocr" ? "Reading..." : "Run OCR"}</button>
        <input className="input h-10 w-52 py-1 text-sm" value={feedSource} onChange={(event) => setFeedSource(event.target.value)} placeholder="14337 or host/MLBB.json" aria-label="MLBB HUD OCR feed port or URL" />
        <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void readMlbbHudFeed()}><Radio size={15} />{busy === "feed" ? "Reading..." : "Read Feed"}</button>
        <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void saveCalibration()}><Save size={15} />Save Calibration</button>
      </div>
    </section>

    <section className="cv-status-strip">{message}</section>

    <section className="cv-metrics-grid">
      <OcrMetric label="Frame" value={frameSize.width ? `${frameSize.width}x${frameSize.height}` : "None"} detail={frameLabel} />
      <OcrMetric label="Capture Source" value={running ? sourceLabel : "Idle"} detail={running ? sourceMode : "start capture or import"} />
      <OcrMetric label="OCR Runtime" value={ocrReady ? "Ready" : "Missing"} detail={status?.runtimePath ?? "PaddleOCR screen reader"} />
      <OcrMetric label="Profile" value="MLBB HUD" detail={`${regions.length} normalized regions`} />
      <OcrMetric label="Read Fields" value={`${results.filter((fact) => fact.text).length}/${regions.length}`} detail="last OCR pass" />
      <OcrMetric label="Calibration" value={edited ? "Unsaved" : "Saved"} detail="OBS region store merge" />
    </section>

    <section className="cv-ocr-grid">
      <div className="cv-video-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h3 className="text-lg font-black text-white">Frame Overlay</h3>
            <p className="mt-1 text-sm text-slate-400">Draw on the image to replace the selected ROI, or tune exact normalized values in the inspector.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!ocrReady ? <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void installRuntime()}><RefreshCw size={15} />Install OCR</button> : null}
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void refreshStatus()}><RefreshCw size={15} />Refresh</button>
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={resetPreset}><RotateCcw size={15} />Preset</button>
          </div>
        </div>
        <div className="p-4">
          <div
            className="cv-ocr-canvas"
            style={{ aspectRatio: frameSize.width && frameSize.height ? `${frameSize.width} / ${frameSize.height}` : "16 / 9" }}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={finishDraw}
            onPointerCancel={() => setDrawing(null)}
          >
            {frameUrl ? <img src={frameUrl} alt="" draggable={false} /> : <div className="cv-empty-stage">
              <div className="max-w-sm p-6 text-center">
                <ScanText className="mx-auto h-10 w-10 text-cyan-200" />
                <div className="mt-3 text-sm font-black uppercase text-white">Load a gameplay HUD frame</div>
                <div className="mt-2 text-sm text-slate-400">The MLBB preset appears as normalized boxes as soon as a frame is visible.</div>
              </div>
            </div>}
            {frameUrl ? regions.map((region) => <button
              key={region.id}
              type="button"
              className={`cv-ocr-region cv-ocr-region-${region.mode} ${region.id === selectedId ? "cv-ocr-region-active" : ""}`}
              style={rectStyle(region.rect)}
              onPointerDown={(event) => { event.stopPropagation(); setSelectedId(region.id); }}
              title={`${region.key} ${region.value ?? ""}`.trim()}
            >
              <span>{region.key}{region.value ? ` ${region.value}` : ""}</span>
            </button>) : null}
            {draftRect ? <div className="cv-ocr-region cv-ocr-region-draft" style={rectStyle(draftRect)}><span>new ROI</span></div> : null}
          </div>
        </div>
      </div>

      <aside className="cv-inspector-panel">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-white">OCR Regions</h3>
              <p className="mt-1 text-sm text-slate-400">Normalized ROIs adapt to frame size instead of separate device models.</p>
            </div>
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={addRegion}>Add</button>
          </div>
        </div>

        <div className="touch-scroll max-h-[360px] space-y-2 overflow-auto p-3">
          {regions.map((region) => <button
            key={region.id}
            type="button"
            className={`cv-ocr-row ${region.id === selectedId ? "cv-ocr-row-active" : ""}`}
            onClick={() => setSelectedId(region.id)}
          >
            <span className={`cv-ocr-dot cv-ocr-dot-${region.mode}`} />
            <span className="min-w-0 flex-1 truncate text-left">{region.key}</span>
            <span className="text-slate-300">{region.value || "-"}</span>
            <span className="w-10 text-right text-slate-500">{region.confidence != null ? Math.round(region.confidence * 100) : "-"}</span>
          </button>)}
        </div>

        {selectedRegion ? <div className="border-t border-white/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-black uppercase text-slate-500">Selected</div>
              <div className="truncate text-base font-black text-white">{selectedRegion.key}</div>
            </div>
            <button className="cv-control-button" disabled={regions.length <= 1 || Boolean(busy)} onClick={deleteSelectedRegion}><Trash2 size={15} />Delete</button>
          </div>

          <label className="mt-4 block text-xs font-black uppercase text-slate-500">Region Key</label>
          <input className="input mt-1 min-h-10 w-full py-1 text-sm" value={selectedRegion.key} onChange={(event) => updateSelected({ key: event.target.value.trim() || selectedRegion.key })} />

          <label className="mt-3 block text-xs font-black uppercase text-slate-500">Read Mode</label>
          <select className="input mt-1 min-h-10 w-full py-1 text-sm" value={selectedRegion.mode} onChange={(event) => updateSelected({ mode: event.target.value as OcrMode })}>
            <option value="gold">Gold value</option>
            <option value="number">Number</option>
            <option value="timer">Timer</option>
            <option value="text">Text</option>
          </select>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {["x", "y", "w", "h"].map((label, index) => <label key={label} className="block">
              <span className="text-xs font-black uppercase text-slate-500">{label}</span>
              <input
                className="input mt-1 min-h-9 w-full py-1 text-sm"
                type="number"
                min={0}
                max={1}
                step={0.001}
                value={selectedRegion.rect[index]}
                onChange={(event) => updateSelectedRect(index, Number(event.target.value))}
              />
            </label>)}
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="flex items-center justify-between gap-2 text-xs font-black uppercase text-slate-500">
              <span>Last Value</span>
              <span>{selectedRegion.confidence != null ? `${Math.round(selectedRegion.confidence * 100)}%` : "not read"}</span>
            </div>
            <div className="mt-2 min-h-8 break-words text-lg font-black text-white">{selectedRegion.value || "-"}</div>
          </div>
        </div> : null}

        <div className="border-t border-white/10 p-4">
          <div className="text-xs font-black uppercase text-slate-500">Live JSON</div>
          <pre className="cv-ocr-json mt-2">{JSON.stringify(liveJson, null, 2)}</pre>
        </div>
      </aside>
    </section>
  </div>;
}

function OcrMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric-card">
    <div>
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value">{value}</div>
    </div>
    <div className="metric-card-detail">{detail}</div>
  </div>;
}

function feedQueryParams(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  return /^\d{1,5}$/.test(trimmed) ? { port: trimmed } : { url: trimmed };
}

function toOcrRegions(value: unknown): OcrRegion[] {
  const rows = Array.isArray(value) ? value : fallbackMlbbRegions;
  return rows.flatMap((item: any) => {
    const key = String(item?.key ?? item?.region ?? "").trim();
    const rect = normalizeReviewRect(item?.rect);
    if (!key || !rect) return [];
    return [{ id: key, key, rect, mode: modeForKey(key), value: item?.value, confidence: item?.confidence }] as OcrRegion[];
  });
}

function modeForKey(key: string): OcrMode {
  if (/gold/i.test(key)) return "gold";
  if (/timer|time/i.test(key)) return "timer";
  if (/score|lord|turret/i.test(key)) return "number";
  return "text";
}

function fromPixels(x: number, y: number, width: number, height: number): Rect {
  return [round(x / 1920), round(y / 1080), round(width / 1920), round(height / 1080)];
}

function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
  return normalizeReviewRect([
    Math.min(start.x, end.x),
    Math.min(start.y, end.y),
    Math.abs(end.x - start.x),
    Math.abs(end.y - start.y),
  ]);
}

function rectStyle(rect: Rect) {
  return {
    left: `${rect[0] * 100}%`,
    top: `${rect[1] * 100}%`,
    width: `${rect[2] * 100}%`,
    height: `${rect[3] * 100}%`,
  };
}

function calibrationKey(key: string) {
  const normalized = key.trim().replace(/_norm$/i, "").replace(/[^a-z0-9_]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return `${normalized || "screen_ocr"}_norm`;
}

function unionRect(rects: Rect[]) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect[0]));
  const top = Math.min(...rects.map((rect) => rect[1]));
  const right = Math.max(...rects.map((rect) => rect[0] + rect[2]));
  const bottom = Math.max(...rects.map((rect) => rect[1] + rect[3]));
  return normalizeReviewRect([left, top, right - left, bottom - top]);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function round(value: number) {
  return Number(value.toFixed(6));
}
