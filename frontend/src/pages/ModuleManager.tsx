import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";

export function ModuleManager() {
  const q = useQuery({ queryKey: ["modules"], queryFn: () => apiGet<any>("/api/modules") });
  return <div className="space-y-5">
    <div><h2 className="text-3xl font-black">Module Manager</h2><p className="text-slate-400">AI-native tactical module SDK foundation.</p></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5"><h3 className="font-bold">SDK Capabilities</h3><pre className="touch-scroll mt-3 max-h-96 overflow-auto rounded-lg bg-black/30 p-3 text-xs">{JSON.stringify(q.data?.sdk, null, 2)}</pre></div>
      <div className="card p-5"><h3 className="font-bold">Installed Modules</h3>{q.data?.modules?.length ? q.data.modules.map((module: any) => <div key={module.id}>{module.name}</div>) : <p className="mt-3 text-slate-400">No modules installed.</p>}</div>
    </div>
  </div>;
}
