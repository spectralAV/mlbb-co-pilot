import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Activity, Boxes, Crosshair, Database, Film, Gamepad2, History, Images, Map, Puzzle, Radio, Radar, Settings, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { CaptureRuntimeHost } from "./CaptureRuntimeHost";
import { PerformanceTelemetryHost } from "./PerformanceTelemetryHost";
import { getPlayerProfile } from "../api/client";
import { useAdvancedSurfacesVisible } from "../runtime/uiPreferences";
import packageJson from "../../package.json";

const links = [
  { to: "/setup", label: "First Run", icon: ShieldCheck },
  { to: "/capture", label: "Live Capture", icon: Radar },
  { to: "/calibration", label: "Screen Setup", icon: SlidersHorizontal },
  { to: "/draft", label: "Draft Assistant", icon: Crosshair },
  { to: "/game", label: "Live Game", icon: Gamepad2 },
  { to: "/analysis", label: "Game Review", icon: History },
  { to: "/build", label: "Build Data", icon: Boxes },
  { to: "/mlbb-control", label: "Stream Output", icon: Radio },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/map", label: "Tactical Map", icon: Map, advanced: true },
  { to: "/map-trainer", label: "Map Trainer", icon: SlidersHorizontal, advanced: true },
  { to: "/modules", label: "Modules", icon: Puzzle, advanced: true },
  { to: "/cv-studio", label: "CV Studio", icon: Film, advanced: true },
  { to: "/performance", label: "Performance", icon: Activity, advanced: true },
  { to: "/", label: "Operations", icon: Activity, advanced: true },
  { to: "/skins", label: "Skins", icon: Images, advanced: true },
] as const;

const laneLabels: Record<string, string> = {
  exp: "EXP",
  jungle: "Jungle",
  mid: "Mid",
  roam: "Roam",
  gold: "Gold",
};

export function Layout() {
  const profile = useQuery({ queryKey: ["player-profile"], queryFn: getPlayerProfile, staleTime: 30_000 });
  const profileData = profile.data?.data;
  const profileName = String(profileData?.displayName ?? "Player");
  const profileMeta = [profileData?.rankProfile, laneLabels[String(profileData?.preferredLane ?? "")] ?? profileData?.preferredLane]
    .filter(Boolean)
    .join(" / ");
  const [advancedSurfacesVisible] = useAdvancedSurfacesVisible();
  const visibleLinks = links.filter((link) => advancedSurfacesVisible || !("advanced" in link));

  return <div className="app-shell">
    <CaptureRuntimeHost />
    <PerformanceTelemetryHost />

    <aside className="app-dock hidden lg:sticky lg:top-0 lg:flex">
      <div className="app-brand">
        <div className="app-brand-mark app-brand-mark-desktop"><Database size={18} /></div>
        <div className="app-brand-copy">
          <div className="text-xl font-black leading-none text-white">MLBB</div>
          <div className="mt-2 text-sm font-black uppercase text-cyan-300">CO-PILOT</div>
        </div>
      </div>
      <nav className="app-nav touch-scroll flex-1 overflow-auto">
        {visibleLinks.map(({ to, label, icon: Icon }) => <NavLink
          key={to}
          to={to}
          title={label}
          className={({ isActive }) => `nav-item flex min-h-[4.15rem] items-center gap-3 px-6 text-sm ${isActive ? "nav-item-active" : ""}`}
        >
          <Icon className="shrink-0" size={22} />
          <span className="nav-label leading-tight">{label}</span>
        </NavLink>)}
      </nav>
      <div className="app-dock-footer px-6 pb-6 pt-5">
        <Link to="/settings?tab=profile" className="block border-t border-white/10 pt-5 text-left transition hover:text-cyan-100" title="Edit player profile">
          <div className="text-[10px] font-bold uppercase text-slate-500">Profile</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
            <UserRound className="h-4 w-4 text-cyan-200" />
            <span className="min-w-0 truncate">{profileName}</span>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,.9)]" />
          </div>
          {profileMeta && <div className="mt-1 truncate text-xs text-slate-400">{profileMeta}</div>}
        </Link>
        <div className="mt-6 text-xs text-slate-500">
          <div className="font-bold uppercase">Version</div>
          <div className="mt-2 text-slate-300">v{packageJson.version}</div>
        </div>
      </div>
    </aside>

    <header className="mobile-top sticky top-0 z-40 border-b px-3 py-2 lg:hidden">
      <div className="flex items-center gap-2">
        <div className="app-brand-mark !h-9 !w-9"><Database size={18} /></div>
        <div>
          <h1 className="text-base font-black leading-none text-white">MLBB Co-Pilot</h1>
          <p className="mt-1 text-[10px] font-bold uppercase text-cyan-300">Tactical Ops</p>
        </div>
      </div>
    </header>

    <main className="app-main"><Outlet /></main>

    <nav className="mobile-nav safe-bottom fixed inset-x-0 bottom-0 z-50 border-t px-2 py-2 lg:hidden">
      <div className="touch-scroll flex gap-2 overflow-x-auto">
        {visibleLinks.map(({ to, label, icon: Icon }) => <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `flex min-h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-lg border px-3 text-[11px] font-bold ${isActive ? "border-cyan-300/35 bg-cyan-400/15 text-cyan-50" : "border-white/10 bg-white/[0.04] text-slate-300"}`}
        >
          <Icon size={18} />
          <span className="whitespace-nowrap">{label}</span>
        </NavLink>)}
      </div>
    </nav>
  </div>;
}
