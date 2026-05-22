import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Brush, Crosshair, ImageDown, MousePointer2, Save, Trash2 } from "lucide-react";
import { getMapZones, saveMapZones } from "../api/client";

type Point = [number, number];
type DrawMode = "polygon" | "freehand";
type TrainerSection = "tactical" | "minimap-ai";
type Zone = {
  id: string;
  name: string;
  type: string;
  polygon: Point[];
  drawMode?: DrawMode;
  dangerWeight: number;
  connectedZones?: string[];
};

const tacticalMapReference = "/assets/map/mlbb-tactical-map-reference.png";
const minimapRoi = { x: 0.01, y: 0.02, w: 0.17, h: 0.28 };
const zoneTypes = ["broken-wall", "bush", "river", "objective", "jungle", "lane", "danger", "vision", "semantic"];
const minimapLabels = ["ally-hero", "enemy-hero", "objective", "turret", "jungle-camp", "lane-minion", "dangerous-grass", "broken-wall", "flying-cloud", "expanding-river"];
const colors: Record<string, { stroke: string; fill: string }> = {
  "broken-wall": { stroke: "#22c55e", fill: "rgba(34,197,94,.18)" },
  bush: { stroke: "#84cc16", fill: "rgba(132,204,22,.18)" },
  river: { stroke: "#38bdf8", fill: "rgba(56,189,248,.18)" },
  objective: { stroke: "#f59e0b", fill: "rgba(245,158,11,.18)" },
  jungle: { stroke: "#10b981", fill: "rgba(16,185,129,.16)" },
  lane: { stroke: "#a78bfa", fill: "rgba(167,139,250,.16)" },
  danger: { stroke: "#f43f5e", fill: "rgba(244,63,94,.16)" },
  vision: { stroke: "#e879f9", fill: "rgba(232,121,249,.16)" },
  semantic: { stroke: "#93c5fd", fill: "rgba(147,197,253,.16)" }
};

function toPath(points: Point[]) {
  if (!points.length) return "";
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x * 100} ${y * 100}`).join(" ") + " Z";
}

function smoothFreehand(points: Point[]) {
  if (points.length <= 80) return points;
  const step = Math.ceil(points.length / 80);
  return points.filter((_, index) => index % step === 0);
}

export function MapTrainer() {
  const frameUrlRef = useRef("");
  const minimapUrlRef = useRef("");
  const boardRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const [section, setSection] = useState<TrainerSection>("tactical");
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Point[]>([]);
  const [mode, setMode] = useState<DrawMode>("freehand");
  const [name, setName] = useState("Broken wall zone");
  const [type, setType] = useState("broken-wall");
  const [dangerWeight, setDangerWeight] = useState(0.6);
  const [frameUrl, setFrameUrl] = useState("");
  const [frameSize, setFrameSize] = useState({ width: 2856, height: 1280 });
  const [minimapUrl, setMinimapUrl] = useState("");
  const [minimapSize, setMinimapSize] = useState({ width: 512, height: 512 });
  const [minimapLabel, setMinimapLabel] = useState("ally-hero");
  const [minimapSamples, setMinimapSamples] = useState<Array<{ id: string; label: string; width: number; height: number }>>([]);
  const selected = zones.find((zone) => zone.id === selectedId);

  useEffect(() => {
    void loadZones();
    return () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      if (minimapUrlRef.current) URL.revokeObjectURL(minimapUrlRef.current);
    };
  }, []);

  async function loadZones() {
    const result = await getMapZones();
    setZones(result.data ?? []);
  }

  async function loadTacticalCaptureFrame() {
    const response = await fetch(`/api/capture/frame?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    setFrameSize({ width: bitmap.width, height: bitmap.height });
    bitmap.close();
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    const url = URL.createObjectURL(blob);
    frameUrlRef.current = url;
    setFrameUrl(url);
  }

  async function loadMinimapFrame() {
    const response = await fetch(`/api/capture/frame?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const sx = Math.round(bitmap.width * minimapRoi.x);
    const sy = Math.round(bitmap.height * minimapRoi.y);
    const sw = Math.round(bitmap.width * minimapRoi.w);
    const sh = Math.round(bitmap.height * minimapRoi.h);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();
    const crop = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!crop) return;
    if (minimapUrlRef.current) URL.revokeObjectURL(minimapUrlRef.current);
    const url = URL.createObjectURL(crop);
    minimapUrlRef.current = url;
    setMinimapUrl(url);
    setMinimapSize({ width: sw, height: sh });
  }

  function pointFromEvent(event: PointerEvent): Point {
    const rect = boardRef.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    ];
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!boardRef.current) return;
    const point = pointFromEvent(event);
    if (mode === "polygon") {
      setDraft((points) => [...points, point]);
      return;
    }
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft([point]);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current || mode !== "freehand") return;
    const point = pointFromEvent(event);
    setDraft((points) => {
      const last = points.at(-1);
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.006) return points;
      return [...points, point];
    });
  }

  function pointerUp() {
    drawingRef.current = false;
  }

  function saveDraft() {
    const polygon = mode === "freehand" ? smoothFreehand(draft) : draft;
    if (polygon.length < 3) return;
    const zone: Zone = {
      id: selectedId || `${type}-${Date.now()}`,
      name,
      type,
      polygon,
      drawMode: mode,
      dangerWeight,
      connectedZones: selected?.connectedZones ?? []
    };
    setZones((items) => selectedId ? items.map((item) => item.id === selectedId ? zone : item) : [...items, zone]);
    setSelectedId(zone.id);
    setDraft([]);
  }

  async function persist() {
    const result = await saveMapZones(zones);
    setZones(result.data ?? zones);
  }

  function addMinimapSample() {
    if (!minimapUrl) return;
    setMinimapSamples((items) => [
      { id: `${minimapLabel}-${Date.now()}`, label: minimapLabel, width: minimapSize.width, height: minimapSize.height },
      ...items
    ]);
  }

  function editZone(zone: Zone) {
    setSelectedId(zone.id);
    setName(zone.name);
    setType(zone.type);
    setDangerWeight(zone.dangerWeight);
    setMode(zone.drawMode ?? "polygon");
    setDraft(zone.polygon);
  }

  function deleteZone() {
    if (!selectedId) return;
    setZones((items) => items.filter((zone) => zone.id !== selectedId));
    setSelectedId("");
    setDraft([]);
  }

  const draftColor = colors[type] ?? colors.semantic;
  const counts = useMemo(() => zones.reduce<Record<string, number>>((acc, zone) => ({ ...acc, [zone.type]: (acc[zone.type] ?? 0) + 1 }), {}), [zones]);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Map Trainer</h2>
        <p className="text-slate-400">Separate tactical-map zone editing from minimap AI recognition training.</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-1 sm:w-auto">
        <button className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold ${section === "tactical" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSection("tactical")}><Crosshair className="mr-2 inline h-4 w-4" />Tactical Map</button>
        <button className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold ${section === "minimap-ai" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSection("minimap-ai")}><Brain className="mr-2 inline h-4 w-4" />Minimap AI</button>
      </div>
    </div>

    {section === "tactical" ? <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_380px]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
          <div>
            <h3 className="font-bold">Tactical Map Zones</h3>
            <p className="text-xs text-slate-400">Draw semantic regions on the full tactical reference, not the minimap crop.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn inline-flex items-center gap-2" onClick={loadTacticalCaptureFrame}><ImageDown className="h-4 w-4" />Live Frame</button>
            <button className="btn inline-flex items-center gap-2" onClick={persist}><Save className="h-4 w-4" />Save Zones</button>
          </div>
        </div>
        <div ref={boardRef} className="relative touch-none select-none bg-[#020711]" style={{ aspectRatio: `${frameSize.width} / ${frameSize.height}` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
          <img src={frameUrl || tacticalMapReference} alt="" className="absolute inset-0 h-full w-full object-fill opacity-95" draggable={false} />
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {zones.map((zone) => {
              const color = colors[zone.type] ?? colors.semantic;
              return <path key={zone.id} d={toPath(zone.polygon)} fill={color.fill} stroke={color.stroke} strokeWidth={selectedId === zone.id ? 0.8 : 0.45} vectorEffect="non-scaling-stroke" />;
            })}
            {draft.length > 1 && <path d={toPath(draft)} fill={draftColor.fill} stroke={draftColor.stroke} strokeDasharray={mode === "polygon" ? "2 1.5" : undefined} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />}
            {draft.map(([x, y], index) => <circle key={`${x}-${y}-${index}`} cx={x * 100} cy={y * 100} r={0.55} fill={draftColor.stroke} vectorEffect="non-scaling-stroke" />)}
          </svg>
          <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-2 text-xs text-slate-200">{frameUrl ? `${frameSize.width}x${frameSize.height}` : "Full tactical map reference"}</div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <h3 className="font-bold">Draw Zone</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${mode === "freehand" ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => setMode("freehand")}><Brush className="mr-2 inline h-4 w-4" />Freehand</button>
            <button className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${mode === "polygon" ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => setMode("polygon")}><MousePointer2 className="mr-2 inline h-4 w-4" />Polygon</button>
          </div>
          <input className="input mt-3 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          <select className="input mt-3 w-full" value={type} onChange={(event) => setType(event.target.value)}>{zoneTypes.map((item) => <option key={item}>{item}</option>)}</select>
          <label className="mt-3 block text-sm text-slate-300">Danger weight {dangerWeight.toFixed(2)}</label>
          <input className="mt-2 w-full" type="range" min="0" max="1" step="0.05" value={dangerWeight} onChange={(event) => setDangerWeight(Number(event.target.value))} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn" onClick={saveDraft} disabled={draft.length < 3}>{selectedId ? "Update" : "Add"} Zone</button>
            <button className="min-h-11 rounded-lg bg-white/10 px-3 py-2" onClick={() => { setDraft([]); setSelectedId(""); }}>New</button>
          </div>
          <button className="mt-2 min-h-11 w-full rounded-lg bg-red-500/20 px-3 py-2 text-red-100" onClick={deleteZone} disabled={!selectedId}><Trash2 className="mr-2 inline h-4 w-4" />Delete Selected</button>
        </div>

        <div className="card p-4">
          <h3 className="font-bold">Saved Zones</h3>
          <div className="mt-2 flex flex-wrap gap-1">{Object.entries(counts).map(([zoneType, count]) => <span className="chip" key={zoneType}>{zoneType}: {count}</span>)}</div>
          <div className="touch-scroll mt-3 max-h-[48vh] overflow-auto pr-1">
            {zones.map((zone) => {
              const color = colors[zone.type] ?? colors.semantic;
              return <button key={zone.id} className={`mb-2 w-full rounded-lg border p-3 text-left ${selectedId === zone.id ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => editZone(zone)}>
                <div className="flex items-center justify-between gap-3"><b>{zone.name}</b><span className="text-xs" style={{ color: color.stroke }}>{zone.type}</span></div>
                <div className="mt-1 text-xs text-slate-400">{zone.polygon.length} points / danger {zone.dangerWeight}</div>
              </button>;
            })}
          </div>
        </div>
      </aside>
    </div> : <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_380px]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
          <div>
            <h3 className="font-bold">Minimap AI Training</h3>
            <p className="text-xs text-slate-400">Crop the live minimap, label samples, then project detections onto the tactical map runtime.</p>
          </div>
          <button className="btn inline-flex items-center gap-2" onClick={loadMinimapFrame}><ImageDown className="h-4 w-4" />Pull Minimap Frame</button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(260px,520px)_1fr]">
          <div>
            <div className="relative aspect-square overflow-hidden rounded-xl border border-cyan-300/20 bg-black">
              {minimapUrl ? <img className="h-full w-full object-fill" src={minimapUrl} alt="" draggable={false} /> : <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-400">Pull a native capture frame to crop the minimap ROI for AI samples.</div>}
              <div className="absolute left-3 top-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">{minimapUrl ? `${minimapSize.width}x${minimapSize.height}` : "minimap ROI"}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select className="input w-full" value={minimapLabel} onChange={(event) => setMinimapLabel(event.target.value)}>{minimapLabels.map((item) => <option key={item}>{item}</option>)}</select>
              <button className="btn" onClick={addMinimapSample} disabled={!minimapUrl}>Add Sample</button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h4 className="font-bold">AI Recognition Targets</h4>
              <div className="mt-3 flex flex-wrap gap-2">{minimapLabels.map((item) => <button key={item} className={`chip ${minimapLabel === item ? "border-cyan-300 bg-cyan-500/20 text-cyan-100" : ""}`} onClick={() => setMinimapLabel(item)}>{item}</button>)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h4 className="font-bold">Projection Path</h4>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                <div className="rounded-lg bg-black/25 p-3">1. Detect marker/icon in minimap coordinates.</div>
                <div className="rounded-lg bg-black/25 p-3">2. Normalize to square minimap x/y.</div>
                <div className="rounded-lg bg-black/25 p-3">3. Warp through minimap-to-tactical projection.</div>
                <div className="rounded-lg bg-black/25 p-3">4. Resolve tactical semantic zone and coaching event.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="card p-4">
        <h3 className="font-bold">Minimap Samples</h3>
        <p className="mt-1 text-xs text-slate-400">These are AI dataset entries, separate from tactical semantic zones.</p>
        <div className="touch-scroll mt-3 max-h-[66vh] overflow-auto pr-1">
          {minimapSamples.length === 0 && <div className="rounded-lg bg-white/5 p-3 text-sm text-slate-400">No minimap samples in this browser session yet.</div>}
          {minimapSamples.map((sample) => <div className="mb-2 rounded-lg border border-white/10 bg-white/5 p-3" key={sample.id}>
            <div className="font-bold">{sample.label}</div>
            <div className="mt-1 text-xs text-slate-400">{sample.width}x{sample.height} minimap crop</div>
          </div>)}
        </div>
      </aside>
    </div>}
  </div>;
}
