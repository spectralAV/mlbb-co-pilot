import { useState } from "react";
import { applyPatchZip } from "../../api/client";

export function FirmwareUpdates() {
  const [file, setFile] = useState<File | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setLog("Uploading CV module...");
    try {
      setLog(JSON.stringify(await applyPatchZip(file), null, 2));
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="card p-5 space-y-4">
    <div>
      <h3 className="font-bold text-xl">CV Module Updates</h3>
      <p className="text-sm text-slate-400">Upload trial CV module ZIPs for local draft, minimap, OCR, result-screen, or training experiments.</p>
    </div>
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-500/10 p-3 text-sm text-cyan-50">
      Preferred manifests use <code>type: "cv-module"</code> with a <code>cvModule</code> block declaring surfaces and entrypoints.
    </div>
    <input className="input w-full" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    <button className="btn" disabled={!file || busy} onClick={upload}>{busy ? "Uploading..." : "Upload CV Module ZIP"}</button>
    {log && <pre className="overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-200">{log}</pre>}
  </section>;
}
