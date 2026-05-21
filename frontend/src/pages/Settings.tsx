import { useState } from "react";
import { DataSync } from "./Settings/DataSync";
import { FirmwareUpdates } from "./Settings/FirmwareUpdates";
import { RuntimeStatus } from "./Settings/RuntimeStatus";

const tabs = ["General", "Data Sync", "Runtime Status", "Module Updates", "Developer"] as const;

export function Settings(){
  const [tab, setTab] = useState<(typeof tabs)[number]>("General");
  return <div className="space-y-5">
    <div>
      <h2 className="text-3xl font-black">Settings</h2>
      <p className="text-slate-400">Profile, official data sync, runtime cache, module patches, and developer controls.</p>
    </div>
    <div className="flex flex-wrap gap-2">{tabs.map((name)=><button key={name} className={`rounded-lg px-3 py-2 text-sm ${tab===name?"bg-violet-600":"bg-white/10 hover:bg-white/15"}`} onClick={()=>setTab(name)}>{name}</button>)}</div>
    {tab==="General"&&<div className="grid grid-cols-2 gap-4"><div className="card p-5"><h3 className="font-bold mb-3">Player Profile</h3><label>Rank Profile<select className="input block mt-2 w-full"><option>Mythic</option><option>Mythical Honor</option><option>Mythical Glory+</option></select></label><label className="block mt-4">Preferred Role<select className="input block mt-2 w-full"><option>Jungle</option><option>Roam</option><option>Mid Lane</option><option>Gold Lane</option><option>Exp Lane</option></select></label></div><div className="card p-5"><h3 className="font-bold mb-3">Comfort Heroes</h3><textarea className="input w-full min-h-32" placeholder="Aamon, Karina, Julian..."/><p className="text-sm text-slate-400 mt-2">These affect recommendation scoring in v0.4.0 draft analysis.</p></div></div>}
    {tab==="Data Sync"&&<DataSync/>}
    {tab==="Runtime Status"&&<RuntimeStatus/>}
    {tab==="Module Updates"&&<FirmwareUpdates/>}
    {tab==="Developer"&&<div className="card p-5"><h3 className="font-bold mb-3">Developer</h3><p className="text-sm text-slate-400">Backend health, semantic cache, event bus, and module runtime endpoints remain available through the existing API.</p></div>}
  </div>
}
