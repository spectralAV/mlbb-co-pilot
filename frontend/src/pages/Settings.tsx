import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { getPlayerProfile, savePlayerProfile } from "../api/client";
import { useAdvancedSurfacesVisible } from "../runtime/uiPreferences";
import { DataSync } from "./Settings/DataSync";
import { FirmwareUpdates } from "./Settings/FirmwareUpdates";
import { RoneApi } from "./Settings/RoneApi";
import { RuntimeStatus } from "./Settings/RuntimeStatus";

const tabs = ["Profile", "Data Sync", "Rone API", "Runtime Status", "Module Updates", "Developer"] as const;

function tabSlug(tab: (typeof tabs)[number]) {
  return tab.toLowerCase().replace(/\s+/g, "-");
}

export function Settings(){
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabs.find((name) => tabSlug(name) === searchParams.get("tab")) ?? "Profile";
  return <div className="space-y-5">
    <div>
      <h2>Settings</h2>
      <p className="mt-3 max-w-3xl text-slate-400">Profile, official data sync, runtime cache, CV module uploads, and developer controls.</p>
      <Link className="capture-secondary-button mt-4 inline-flex" to="/setup"><ShieldCheck size={16} /> First Run Setup</Link>
    </div>
    <div className="card flex flex-wrap gap-2 p-2">{tabs.map((name)=><button key={name} className={`min-h-10 rounded-full border px-4 py-2 text-sm font-bold ${tab===name?"border-cyan-300/35 bg-cyan-400/15 text-cyan-50":"border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"}`} onClick={()=>setSearchParams({ tab: tabSlug(name) })}>{name}</button>)}</div>
    {tab==="Profile"&&<PlayerProfileSettings/>}
    {tab==="Data Sync"&&<DataSync/>}
    {tab==="Rone API"&&<RoneApi/>}
    {tab==="Runtime Status"&&<RuntimeStatus/>}
    {tab==="Module Updates"&&<FirmwareUpdates/>}
    {tab==="Developer"&&<DeveloperSettings/>}
  </div>
}

function DeveloperSettings() {
  const [advancedSurfacesVisible, setAdvancedSurfacesVisible] = useAdvancedSurfacesVisible();
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
    <section className="card p-5">
      <h3 className="mb-3 font-bold">Developer</h3>
      <p className="text-sm text-slate-400">Backend health, semantic cache, event bus, and module runtime endpoints remain available through the existing API.</p>
      <label className="mt-5 flex min-h-16 items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
        <span>
          <span className="block font-bold text-white">Show advanced CV and Operations surfaces</span>
          <span className="mt-1 block text-sm text-slate-400">Reveals CV Video, Performance, Operations, Skins, and CV Lab in the navigation.</span>
        </span>
        <input
          type="checkbox"
          checked={advancedSurfacesVisible}
          onChange={(event) => setAdvancedSurfacesVisible(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-cyan-400"
        />
      </label>
    </section>
    <aside className="card p-5">
      <div className="text-xs font-bold uppercase text-slate-500">Navigation Mode</div>
      <div className="mt-2 text-2xl font-black text-white">{advancedSurfacesVisible ? "Developer" : "User"}</div>
      <p className="mt-3 text-sm text-slate-400">{advancedSurfacesVisible ? "Advanced model-training and diagnostic surfaces are visible." : "Only user-facing capture, draft, build, stream, and settings surfaces are visible."}</p>
    </aside>
  </div>;
}

function PlayerProfileSettings() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ["player-profile"], queryFn: getPlayerProfile });
  const [displayName, setDisplayName] = useState("Rokas");
  const [rankProfile, setRankProfile] = useState("Mythic");
  const [preferredLane, setPreferredLane] = useState("jungle");
  const [comfortHeroes, setComfortHeroes] = useState("");
  const save = useMutation({
    mutationFn: () => savePlayerProfile({
      displayName,
      rankProfile,
      preferredLane,
      comfortHeroes: comfortHeroes.split(",").map((hero) => hero.trim()).filter(Boolean),
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["player-profile"] }),
  });

  useEffect(() => {
    const data = profile.data?.data;
    if (!data) return;
    setDisplayName(data.displayName ?? "Rokas");
    setRankProfile(data.rankProfile ?? "Mythic");
    setPreferredLane(data.preferredLane ?? "jungle");
    setComfortHeroes((data.comfortHeroes ?? []).join(", "));
  }, [profile.data]);

  return <div className="grid gap-4 md:grid-cols-2">
    <div className="card p-5">
      <h3 className="mb-3 font-bold">Player Profile</h3>
      <label>Display Name
        <input className="input mt-2 block w-full" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Rokas" />
      </label>
      <label className="mt-4 block">Rank Profile
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
