import { NavLink, Outlet } from "react-router-dom";
import { Activity, Boxes, Crosshair, Database, Radio, Radar, Settings, SlidersHorizontal } from "lucide-react";
import { CaptureRuntimeHost } from "./CaptureRuntimeHost";
const links=[["/","Status",Activity],["/capture","Live",Radar],["/draft","Draft",Crosshair],["/calibration","Calibration",SlidersHorizontal],["/build","Build Data",Boxes],["/mlbb-control","Stream Output",Radio],["/settings","Settings",Settings]] as const;
export function Layout(){return <div className="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
  <CaptureRuntimeHost/>
  <aside className="hidden border-r border-white/10 bg-black/30 p-4 lg:block lg:h-screen lg:sticky lg:top-0">
    <div className="mb-6 flex items-center gap-3"><Database className="text-violet-400"/><div><h1 className="text-xl font-black">MLBB Co-Pilot</h1><p className="text-xs text-slate-400">Semantic Tactical Runtime</p></div></div>
    <nav className="space-y-2">{links.map(([to,label,Icon])=><NavLink key={to} to={to} className={({isActive})=>`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 ${isActive?"bg-violet-600":"hover:bg-white/10"}`}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
  </aside>
  <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07111f]/95 px-3 py-2 backdrop-blur lg:hidden">
    <div className="flex items-center gap-2"><Database className="text-violet-400" size={20}/><div><h1 className="text-base font-black">MLBB Co-Pilot</h1><p className="text-[11px] text-slate-400">Tactical Runtime</p></div></div>
  </header>
  <main className="min-w-0 p-3 pb-24 sm:p-4 lg:p-6 lg:pb-6"><Outlet/></main>
  <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#07111f]/95 px-2 py-2 backdrop-blur lg:hidden">
    <div className="touch-scroll flex gap-2 overflow-x-auto">
      {links.map(([to,label,Icon])=><NavLink key={to} to={to} className={({isActive})=>`flex min-h-14 min-w-20 flex-col items-center justify-center gap-1 rounded-lg px-3 text-[11px] font-semibold ${isActive?"bg-violet-600 text-white":"bg-white/5 text-slate-300"}`}><Icon size={18}/><span className="whitespace-nowrap">{label}</span></NavLink>)}
    </div>
  </nav>
</div>}
