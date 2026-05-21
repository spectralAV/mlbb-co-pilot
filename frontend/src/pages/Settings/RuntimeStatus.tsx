import { useEffect, useState } from "react";
import { getRuntimeStatus } from "../../api/client";

export function RuntimeStatus() {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setStatus(await getRuntimeStatus());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, []);

  return <section className="card p-5 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="font-bold text-xl">Runtime Status</h3>
        <p className="text-sm text-slate-400">Compiled official hero runtime cache.</p>
      </div>
      <button className="btn" onClick={load}>Refresh</button>
    </div>
    {error && <p className="text-red-300">{error}</p>}
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg bg-white/5 p-3"><b>Exists</b><div>{status?.exists ? "Yes" : "No"}</div></div>
      <div className="rounded-lg bg-white/5 p-3"><b>Heroes</b><div>{status?.heroCount ?? 0}</div></div>
      <div className="rounded-lg bg-white/5 p-3"><b>Updated</b><div className="truncate">{status?.updatedAt ?? "Never"}</div></div>
    </div>
  </section>;
}
