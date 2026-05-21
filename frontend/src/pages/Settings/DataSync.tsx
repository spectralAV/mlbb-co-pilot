import { useState } from "react";
import { apiPost } from "../../api/client";

export function DataSync() {
  const [authorization, setAuthorization] = useState("");
  const [rank, setRank] = useState("101");
  const [matchType, setMatchType] = useState(0);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    setLog("Syncing official MLBB data...");
    try {
      const result = await apiPost<any>("/api/sync/official", { authorization, rank, matchType, lang: "en" });
      setLog(JSON.stringify(result, null, 2));
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="card p-5 space-y-4">
    <div>
      <h3 className="font-bold text-xl">Data Sync</h3>
      <p className="text-sm text-slate-400">Refresh heroes, roles, lanes, relations, meta stats, and patch feed from official MLBB web data sources.</p>
    </div>
    <label className="block text-sm">GMS authorization token<input className="input mt-2 w-full" type="password" value={authorization} onChange={(e) => setAuthorization(e.target.value)} placeholder="Paste fresh authorization header value" /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm">Rank bracket<input className="input mt-2 w-full" value={rank} onChange={(e) => setRank(e.target.value)} /></label>
      <label className="block text-sm">Match type<input className="input mt-2 w-full" type="number" value={matchType} onChange={(e) => setMatchType(Number(e.target.value))} /></label>
    </div>
    <button className="btn" disabled={busy || authorization.length < 8} onClick={sync}>{busy ? "Syncing..." : "Sync Official Data"}</button>
    {log && <pre className="overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-200">{log}</pre>}
  </section>;
}
