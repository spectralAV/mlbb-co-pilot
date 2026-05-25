import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";
import { BattlefieldMap } from "../components/game/BattlefieldMap";
import { useCaptureRuntimeStore } from "../runtime/captureRuntime";

export function TacticalMap() {
  const map = useQuery({ queryKey: ["map-runtime"], queryFn: () => apiGet<any>("/api/map/runtime") });
  const minimapDetections = useCaptureRuntimeStore((store) => store.minimapDetections);
  const zones = map.data?.zones ?? [];
  const projection = map.data?.projection;
  const corners = projection?.tacticalCorners ?? {};
  return <div className="space-y-5">
    <div><h2 className="text-3xl font-black">Tactical Map</h2><p className="text-slate-400">Semantic zones and objective control foundation.</p></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,725px)_minmax(280px,1fr)]">
      <div className="card p-3 sm:p-4">
        <BattlefieldMap markers={minimapDetections} projection={projection} />
      </div>
      <div className="space-y-4">
        <div className="card p-4">
          <h3 className="mb-3 font-bold">Minimap Projection</h3>
          <p className="text-sm text-slate-300">Square minimap detections are warped into the tactical map rhombus before zone checks.</p>
          <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm text-slate-300">
            Live pins: <b className="text-cyan-200">{minimapDetections.length}</b>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {(["topLeft", "topRight", "bottomRight", "bottomLeft"] as const).map((key) => (
              <div className="rounded-lg bg-white/5 p-3" key={key}>
                <div className="font-bold text-cyan-200">{key}</div>
                <div className="mt-1 text-slate-400">{formatPoint(corners[key])}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4"><h3 className="mb-3 font-bold">Zones</h3><div className="touch-scroll max-h-[52vh] overflow-auto pr-1">{zones.map((zone: any) => <div className="mb-2 rounded-lg bg-white/5 p-3" key={zone.id}><b>{zone.name}</b><p className="text-xs text-slate-400">{zone.type} / danger {zone.dangerWeight}</p></div>)}</div></div>
      </div>
    </div>
  </div>;
}

function formatPoint(point?: number[]) {
  if (!point) return "-";
  return point.map((value) => Number(value).toFixed(3)).join(", ");
}
