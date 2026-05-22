import { type PointerEvent, useEffect, useRef, useState } from "react";
import { addObsRegion, clearObsRegions, getObsConfig, saveObsConfig, getObsRegions, saveObsRegions } from "../api/client";

const regionOptions = [
  ["ally_bans_norm", "Ally Ban Section"],
  ["enemy_bans_norm", "Enemy Ban Section"],
  ["ally_picks_norm", "Ally Team Pick Section"],
  ["enemy_picks_norm", "Enemy Team Pick Section"],
  ["minimap_norm", "Minimap"],
  ["scoreboard_norm", "Scoreboard"],
  ["items_norm", "Items / Builds"],
  ["equipment_window_norm", "Equipment Window"],
  ["attributes_window_norm", "Attributes Window"]
] as const;

type Point = { x: number; y: number };
type SavedRect = { key: string; region: number[]; index: number | null };

const aspectPresets = [
  ["20:9", "20:9 phone", 20, 9],
  ["19.5:9", "19.5:9 phone", 19.5, 9],
  ["19:9", "19:9 phone", 19, 9],
  ["16:9", "16:9 video", 16, 9],
  ["4:3", "4:3 tablet", 4, 3],
  ["3:2", "3:2 tablet", 3, 2],
  ["custom", "Custom", 20, 9]
] as const;

export function Calibration() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const captureUrlRef = useRef("");
  const [key, setKey] = useState("ally_bans_norm");
  const [regions, setRegions] = useState<any>({});
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [selected, setSelected] = useState<number[] | null>(null);
  const [selectedSaved, setSelectedSaved] = useState<{ key: string; index: number | null } | null>(null);
  const [aspectPreset, setAspectPreset] = useState("20:9");
  const [sourceWidth, setSourceWidth] = useState(20);
  const [sourceHeight, setSourceHeight] = useState(9);
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureStatus, setCaptureStatus] = useState("No capture frame loaded");

  async function load() {
    const [savedRegions, config] = await Promise.all([getObsRegions(), getObsConfig().catch(() => ({}))]);
    setRegions(savedRegions);
    const width = Number(config?.screenshotWidth ?? config?.sourceWidth);
    const height = Number(config?.screenshotHeight ?? config?.sourceHeight);
    if (width > 0 && height > 0) {
      setSourceWidth(width);
      setSourceHeight(height);
      setAspectPreset("custom");
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => () => { if (captureUrlRef.current) URL.revokeObjectURL(captureUrlRef.current); }, []);

  function pointer(event: PointerEvent): Point {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(event.clientY - rect.top, rect.height))
    };
  }

  function finish(point: Point) {
    if (!start || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const w = Math.abs(start.x - point.x);
    const h = Math.abs(start.y - point.y);
    setSelected([x / rect.width, y / rect.height, w / rect.width, h / rect.height].map((n) => Number(n.toFixed(6))));
    setSelectedSaved(null);
    setStart(null);
    setCurrent(null);
  }

  async function save() {
    if (!selected) return;
    if (selectedSaved) {
      const next = structuredClone(regions);
      if (selectedSaved.index == null) next[selectedSaved.key] = selected;
      else {
        next[selectedSaved.key] = Array.isArray(next[selectedSaved.key]) ? next[selectedSaved.key] : [];
        next[selectedSaved.key][selectedSaved.index] = selected;
      }
      const result = await saveObsRegions(next);
      setRegions(result.regions);
      setSelectedSaved(null);
      return;
    }
    const result = await addObsRegion(key, selected);
    setRegions(result.regions);
  }

  async function clear(keyToClear: string) {
    const result = await clearObsRegions(keyToClear);
    setRegions(result.regions);
    setSelectedSaved(null);
  }

  async function loadCaptureFrame() {
    setCaptureStatus("Loading native capture frame...");
    try {
      const response = await fetch(`/api/capture/frame?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const image = await createImageBitmap(blob);
      setSourceWidth(image.width);
      setSourceHeight(image.height);
      setAspectPreset("custom");
      image.close();
      if (captureUrlRef.current) URL.revokeObjectURL(captureUrlRef.current);
      const url = URL.createObjectURL(blob);
      captureUrlRef.current = url;
      setCaptureUrl(url);
      setCaptureStatus(`Loaded ${image.width}x${image.height} capture frame`);
    } catch (error) {
      setCaptureStatus(error instanceof Error ? error.message : "Capture frame failed");
    }
  }

  function chooseAspect(value: string) {
    setAspectPreset(value);
    const preset = aspectPresets.find(([id]) => id === value);
    if (preset && value !== "custom") {
      setSourceWidth(preset[2]);
      setSourceHeight(preset[3]);
    }
  }

  async function saveAspect() {
    const existing = await getObsConfig().catch(() => ({}));
    await saveObsConfig({
      ...existing,
      captureRatio: `${sourceWidth}:${sourceHeight}`,
      sourceWidth,
      sourceHeight
    });
  }

  const drag = start && current ? {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    width: Math.abs(start.x - current.x),
    height: Math.abs(start.y - current.y)
  } : null;

  function savedRects(): SavedRect[] {
    const out: SavedRect[] = [];
    for (const [regionKey, value] of Object.entries(regions)) {
      if (!regionKey.endsWith("_norm")) continue;
      if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number")) out.push({ key: regionKey, region: value as number[], index: null });
      else if (Array.isArray(value)) value.forEach((region, index) => { if (Array.isArray(region) && region.length === 4) out.push({ key: regionKey, region: region as number[], index }); });
    }
    return out;
  }

  function colorFor(regionKey: string) {
    if (regionKey.includes("ally")) return { border: "border-cyan-300", bg: "bg-cyan-400/15", text: "text-cyan-100" };
    if (regionKey.includes("enemy")) return { border: "border-red-300", bg: "bg-red-400/15", text: "text-red-100" };
    if (regionKey.includes("mini")) return { border: "border-emerald-300", bg: "bg-emerald-400/15", text: "text-emerald-100" };
    if (regionKey.includes("score")) return { border: "border-amber-300", bg: "bg-amber-400/15", text: "text-amber-100" };
    if (regionKey.includes("equipment")) return { border: "border-violet-300", bg: "bg-violet-400/15", text: "text-violet-100" };
    if (regionKey.includes("attributes")) return { border: "border-fuchsia-300", bg: "bg-fuchsia-400/15", text: "text-fuchsia-100" };
    return { border: "border-sky-300", bg: "bg-sky-400/15", text: "text-sky-100" };
  }

  function selectSaved(rect: SavedRect) {
    setKey(rect.key);
    setSelected(rect.region.map((n) => Number(n.toFixed(6))));
    setSelectedSaved({ key: rect.key, index: rect.index });
  }

  return <div className="space-y-5">
    <div>
      <h2 className="text-3xl font-black">Source Region Calibration</h2>
      <p className="text-slate-400">Draw normalized regions against the source aspect ratio produced by the phone, tablet, capture card, NDI, or stream input.</p>
    </div>
    <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
      <select className="input w-full sm:w-auto" value={aspectPreset} onChange={(event) => chooseAspect(event.target.value)}>{aspectPresets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input className="input w-full sm:w-28" type="number" min="1" step="0.1" value={sourceWidth} onChange={(event) => { setAspectPreset("custom"); setSourceWidth(Number(event.target.value) || 1); }} />
      <input className="input w-full sm:w-28" type="number" min="1" step="0.1" value={sourceHeight} onChange={(event) => { setAspectPreset("custom"); setSourceHeight(Number(event.target.value) || 1); }} />
      <button className="btn w-full sm:w-auto" onClick={saveAspect}>Save Aspect</button>
      <button className="btn w-full sm:w-auto" onClick={loadCaptureFrame}>Load Capture Frame</button>
      <select className="input w-full sm:w-auto" value={key} onChange={(event) => setKey(event.target.value)}>{regionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="btn w-full sm:w-auto" onClick={save} disabled={!selected}>{selectedSaved ? "Update Region" : "Save Region"}</button>
      <button className="btn w-full sm:w-auto" onClick={() => clear(key)}>Clear Selected</button>
      <button className="btn w-full sm:w-auto" onClick={() => clear("all")}>Clear All Lists</button>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div ref={boxRef} className="relative touch-none select-none overflow-hidden rounded-lg border border-sky-300/30 bg-[#03060c]" style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const p = pointer(event); setStart(p); setCurrent(p); }} onPointerMove={(event) => { if (start) setCurrent(pointer(event)); }} onPointerUp={(event) => finish(pointer(event))}>
        {captureUrl && <img src={captureUrl} alt="" className="absolute inset-0 h-full w-full object-fill opacity-90" draggable={false} />}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute left-[1.5%] top-[61.5%] h-[36%] w-[21.5%] rounded border border-violet-300/40 bg-violet-500/10" />
        {savedRects().map((rect, index) => {
          const colors = colorFor(rect.key);
          const active = selectedSaved?.key === rect.key && selectedSaved.index === rect.index;
          return <button type="button" key={`${rect.key}-${rect.index ?? "single"}-${index}`} title={rect.key} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selectSaved(rect); }} className={`absolute border-2 ${colors.border} ${colors.bg} ${active ? "ring-2 ring-white" : ""}`} style={{ left: `${rect.region[0] * 100}%`, top: `${rect.region[1] * 100}%`, width: `${rect.region[2] * 100}%`, height: `${rect.region[3] * 100}%` }}>
            <span className={`absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold ${colors.text}`}>{rect.key.replace(/_norm$/, "")}</span>
          </button>;
        })}
        {drag && <div className="absolute border-2 border-emerald-300 bg-emerald-400/20" style={drag} />}
      </div>
      <aside className="card p-4">
        <h3 className="font-bold">Capture Frame</h3>
        <div className="mt-3 rounded-lg bg-black/30 p-3 text-xs text-slate-300">{captureStatus}</div>
        <h3 className="font-bold">Selected Region</h3>
        <pre className="mt-3 max-h-44 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{selected ? JSON.stringify({ key, editing: selectedSaved, region: selected }, null, 2) : "No selection"}</pre>
        <h3 className="mt-5 font-bold">Saved Regions</h3>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{JSON.stringify(regions, null, 2)}</pre>
      </aside>
    </div>
  </div>;
}
