import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Database, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { apiGet, apiPost } from "../api/client";

export function Dashboard() {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: () => apiGet<any>("/api/health") });
  const meta = useQuery({ queryKey: ["metadata"], queryFn: () => apiGet<any>("/api/cache/metadata") });
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => apiGet<any>("/api/registry/overview") });
  const sync = useMutation({ mutationFn: () => apiPost<any>("/api/sync/all"), onSuccess: () => qc.invalidateQueries() });
  const compile = useMutation({ mutationFn: () => apiPost<any>("/api/semantic/compile"), onSuccess: () => qc.invalidateQueries() });
  const registry = overview.data?.data ?? {};
  const updatedAt = meta.data?.data?.updatedAt ?? "Not synced yet";

  return <div className="space-y-5">
    <header className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
      <div>
        <h2>Operations</h2>
        <p className="mt-3 max-w-2xl text-base text-slate-400">Live runtime status, semantic compiler health, and cache readiness for draft and vision workflows.</p>
      </div>
      <div className="card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase text-slate-500">Runtime</div>
            <div className="mt-1 text-2xl font-black text-white">{health.data?.ok ? "Online" : "Checking"}</div>
          </div>
          <span className={`h-3 w-3 rounded-full ${health.data?.ok ? "bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,.8)]" : "bg-amber-300"}`} />
        </div>
      </div>
    </header>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatusTile icon={Activity} label="Backend" value={health.data?.ok ? "Online" : "Checking"} detail={health.data?.service ?? "MLBB Co-Pilot"} tone="text-emerald-200" />
      <StatusTile icon={Database} label="Cache" value="Metadata" detail={updatedAt} tone="text-cyan-100" />
      <ActionTile icon={RefreshCw} label="Official Sync" value={sync.isPending ? "Syncing" : "Sync All"} onClick={() => sync.mutate()} disabled={sync.isPending} />
      <ActionTile icon={Sparkles} label="Semantic" value={compile.isPending ? "Compiling" : "Compile"} onClick={() => compile.mutate()} disabled={compile.isPending} />
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="card overflow-hidden">
        <div className="border-b border-white/10 p-5">
          <h3 className="text-lg font-black text-white">Registry Overview</h3>
          <p className="mt-1 text-sm text-slate-400">Compiled tactical modules and semantic surface.</p>
        </div>
        <pre className="max-h-[520px] overflow-auto bg-black/35 p-5 text-xs leading-relaxed text-slate-300">{JSON.stringify(registry, null, 2)}</pre>
      </div>
      <aside className="space-y-4">
        <div className="card p-5">
          <h3 className="font-black text-white">Command Surface</h3>
          <div className="mt-4 space-y-3">
            <Metric label="Heroes" value={String(registry?.heroes ?? registry?.heroCount ?? "-")} />
            <Metric label="Items" value={String(registry?.items ?? registry?.itemCount ?? "-")} />
            <Metric label="Rules" value={String(registry?.rules ?? registry?.ruleCount ?? "-")} />
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-black text-white">Next Step</h3>
          <p className="mt-2 text-sm text-slate-400">Sync data, compile semantics, then move into CV Studio or Live capture for model feedback.</p>
        </div>
      </aside>
    </section>
  </div>;
}

function StatusTile({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: string }) {
  return <div className="card p-5">
    <div className="flex items-center justify-between gap-3">
      <div className={`grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] ${tone}`}><Icon size={18} /></div>
      <div className="text-xs font-black uppercase text-slate-500">{label}</div>
    </div>
    <div className="mt-5 text-2xl font-black text-white">{value}</div>
    <div className="mt-1 truncate text-xs text-slate-400">{detail}</div>
  </div>;
}

function ActionTile({ icon: Icon, label, value, onClick, disabled }: { icon: LucideIcon; label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return <div className="card p-5">
    <div className="flex items-center justify-between gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 text-cyan-100"><Icon size={18} /></div>
      <div className="text-xs font-black uppercase text-slate-500">{label}</div>
    </div>
    <button className="btn mt-5 w-full" onClick={onClick} disabled={disabled}>{value}</button>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
    <span className="text-sm text-slate-400">{label}</span>
    <span className="font-black text-white">{value}</span>
  </div>;
}
