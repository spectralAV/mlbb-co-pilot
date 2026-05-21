export function LiveCapture() {
  const regions = ["Ally Picks", "Enemy Picks", "Bans", "Minimap", "Stat Window", "Attribute Window", "Lane Indicators"];
  return <div className="space-y-5">
    <div><h2 className="text-3xl font-black">Live Capture</h2><p className="text-slate-400">OBS/scrcpy automation shell and region calibration.</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card p-5"><h3 className="font-bold">Capture Source</h3><p className="mt-2 text-slate-400">V1 shell. OBS Virtual Camera / scrcpy input connects later.</p></div>
      <div className="card p-5"><h3 className="font-bold">Calibration Regions</h3>{regions.map((region) => <div className="mt-2 rounded-lg bg-white/5 p-3" key={region}>{region}</div>)}</div>
    </div>
  </div>;
}
