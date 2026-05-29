import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { getPlayerProfile, savePlayerProfile } from "../api/client";
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
    {tab==="General"&&<PlayerProfileSettings/>}
    {tab==="Data Sync"&&<DataSync/>}
    {tab==="Runtime Status"&&<RuntimeStatus/>}
    {tab==="Module Updates"&&<FirmwareUpdates/>}
    {tab==="Developer"&&<div className="card p-5"><h3 className="font-bold mb-3">Developer</h3><p className="text-sm text-slate-400">Backend health, semantic cache, event bus, and module runtime endpoints remain available through the existing API.</p></div>}
  </div>
}

function PlayerProfileSettings() {
  const profile = useQuery({ queryKey: ["player-profile"], queryFn: getPlayerProfile });
  const [rankProfile, setRankProfile] = useState("Mythic");
  const [preferredLane, setPreferredLane] = useState("jungle");
  const [comfortHeroes, setComfortHeroes] = useState("");
  const save = useMutation({
    mutationFn: () => savePlayerProfile({
      rankProfile,
      preferredLane,
      comfortHeroes: comfortHeroes.split(",").map((hero) => hero.trim()).filter(Boolean),
    }),
  });

  useEffect(() => {
    const data = profile.data?.data;
    if (!data) return;
    setRankProfile(data.rankProfile ?? "Mythic");
    setPreferredLane(data.preferredLane ?? "jungle");
    setComfortHeroes((data.comfortHeroes ?? []).join(", "));
  }, [profile.data]);

  return <div className="grid gap-4 md:grid-cols-2">
    <div className="card p-5">
      <h3 className="mb-3 font-bold">Player Profile</h3>
      <label>Rank Profile
        <select className="input mt-2 block w-full" value={rankProfile} onChange={(event) => setRankProfile(event.target.value)}>
          <option>Mythic</option><option>Mythical Honor</option><option>Mythical Glory+</option>
        </select>
      </label>
      <label className="mt-4 block">Preferred Lane
        <select className="input mt-2 block w-full" value={preferredLane} onChange={(event) => setPreferredLane(event.target.value)}>
          <option value="jungle">Jungle</option><option value="roam">Roam</option><option value="mid">Mid Lane</option><option value="gold">Gold Lane</option><option value="exp">Exp Lane</option>
        </select>
      </label>
    </div>
    <div className="card p-5">
      <h3 className="mb-3 font-bold">Comfort Heroes</h3>
      <textarea className="input min-h-32 w-full" value={comfortHeroes} onChange={(event) => setComfortHeroes(event.target.value)} placeholder="Aamon, Karina, Julian" />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-400">{save.isSuccess ? "Saved" : save.isError ? "Save failed" : ""}</span>
        <button className="btn flex items-center gap-2" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" />{save.isPending ? "Saving" : "Save Profile"}
        </button>
      </div>
    </div>
  </div>;
}
