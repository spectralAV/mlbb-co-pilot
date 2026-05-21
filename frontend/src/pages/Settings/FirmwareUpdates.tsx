import { useState } from "react";
import { applyPatchZip } from "../../api/client";

export function FirmwareUpdates() {
  const [file, setFile] = useState<File | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setLog("Uploading module patch...");
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
      <h3 className="font-bold text-xl">Module Updates</h3>
      <p className="text-sm text-slate-400">Upload vetted patch ZIPs for app modules and runtime improvements.</p>
    </div>
    <input className="input w-full" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    <button className="btn" disabled={!file || busy} onClick={upload}>{busy ? "Applying..." : "Apply Module ZIP"}</button>
    {log && <pre className="overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-200">{log}</pre>}
  </section>;
}
