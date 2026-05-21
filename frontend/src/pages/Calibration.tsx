import { type PointerEvent, useEffect, useRef, useState } from "react";
import { addObsRegion, clearObsRegions, getObsRegions } from "../api/client";

const regionOptions = [
  ["ally_bans_norm", "Ally Ban Section"],
  ["enemy_bans_norm", "Enemy Ban Section"],
  ["ally_picks_norm", "Ally Team Pick Section"],
  ["enemy_picks_norm", "Enemy Team Pick Section"],
  ["minimap_norm", "Minimap"],
  ["scoreboard_norm", "Scoreboard"],
  ["items_norm", "Items / Builds"]
] as const;

type Point = { x: number; y: number };

export function Calibration() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [key, setKey] = useState("ally_bans_norm");
  const [regions, setRegions] = useState<any>({});
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [selected, setSelected] = useState<number[] | null>(null);

  async function load() {
    setRegions(await getObsRegions());
  }

  useEffect(() => { void load(); }, []);

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
    setStart(null);
    setCurrent(null);
  }

  async function save() {
    if (!selected) return;
    const result = await addObsRegion(key, selected);
    setRegions(result.regions);
  }

  async function clear(keyToClear: string) {
    const result = await clearObsRegions(keyToClear);
    setRegions(result.regions);
  }

  const drag = start && current ? {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    width: Math.abs(start.x - current.x),
    height: Math.abs(start.y - current.y)
  } : null;

  function savedRects() {
    const out: Array<{ key: string; region: number[] }> = [];
    for (const [regionKey, value] of Object.entries(regions)) {
      if (!regionKey.endsWith("_norm")) continue;
      if (regionKey === "minimap_norm" && Array.isArray(value) && value.length === 4) out.push({ key: regionKey, region: value as number[] });
      else if (Array.isArray(value)) for (const region of value) if (Array.isArray(region) && region.length === 4) out.push({ key: regionKey, region });
    }
    return out;
  }

  return <div className="space-y-5">
    <div>
      <h2 className="text-3xl font-black">OBS Region Calibration</h2>
      <p className="text-slate-400">Draw normalized 20:9 regions for draft picks, bans, minimap, scoreboard, and item areas.</p>
    </div>
    <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
      <select className="input w-full sm:w-auto" value={key} onChange={(event) => setKey(event.target.value)}>{regionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <button className="btn w-full sm:w-auto" onClick={save} disabled={!selected}>Save Region</button>
      <button className="btn w-full sm:w-auto" onClick={() => clear(key)}>Clear Selected</button>
      <button className="btn w-full sm:w-auto" onClick={() => clear("all")}>Clear All Lists</button>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div ref={boxRef} className="relative aspect-[20/9] touch-none select-none overflow-hidden rounded-lg border border-sky-300/30 bg-[#03060c]" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); const p = pointer(event); setStart(p); setCurrent(p); }} onPointerMove={(event) => { if (start) setCurrent(pointer(event)); }} onPointerUp={(event) => finish(pointer(event))}>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute left-[1.5%] top-[61.5%] h-[36%] w-[21.5%] rounded border border-violet-300/40 bg-violet-500/10" />
        {savedRects().map(({ key: savedKey, region }, index) => <div key={`${savedKey}-${index}`} title={savedKey} className="absolute border-2 border-sky-300 bg-sky-400/10" style={{ left: `${region[0] * 100}%`, top: `${region[1] * 100}%`, width: `${region[2] * 100}%`, height: `${region[3] * 100}%` }} />)}
        {drag && <div className="absolute border-2 border-emerald-300 bg-emerald-400/20" style={drag} />}
      </div>
      <aside className="card p-4">
        <h3 className="font-bold">Selected Region</h3>
        <pre className="mt-3 max-h-44 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{selected ? JSON.stringify({ key, region: selected }, null, 2) : "No selection"}</pre>
        <h3 className="mt-5 font-bold">Saved Regions</h3>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{JSON.stringify(regions, null, 2)}</pre>
      </aside>
    </div>
  </div>;
}
