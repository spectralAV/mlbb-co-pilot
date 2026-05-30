import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, Database, Image, KeyRound, RefreshCw, SlidersHorizontal, Smartphone } from "lucide-react";
import { apiPost, getAdbAssetStatus, getDinoIdentityStatus, getDraftHeroModelStatus, getRuntimeStatus, getScreenStateTrainingStatus, getSkinSignatureStatus, getTimerOcrStatus, getUltralyticsStatus, indexDinoReferences, installTimerOcrRuntime, installUltralyticsRuntime, syncAdbAssets, trainDraftHeroModel, trainScreenStateModel, trainUltralyticsModel } from "../../api/client";

type ExtractedTexture = { file: string; name: string; width: number; height: number };
type AdbAssetStatus = {
  ok: boolean;
  device: string;
  versionName: string;
  targetCount: number;
  error?: string;
  manifest?: {
    syncedAt: string;
    scope?: "draft" | "vision" | "ui";
    inventory?: {
      uiBundles: number;
      uiBytes: number;
      draftUiBundles: number;
      draftArtBundles: number;
      draftBundles: number;
      visionBundles: number;
      coverage: Array<{ surface: string; uiBundles: number; artBundles: number; total: number }>;
    };
    library?: { uiComplete: boolean; uiDownloaded: number; uiBundles: number };
    bundles: Array<{ id: string; category: string; file: string; bytes: number }>;
    extraction: { textures: number; bundles: Array<{ textures: ExtractedTexture[] }> };
  } | null;
};
type ScreenTrainingStatus = {
  available: boolean;
  model?: {
    trainedAt: string;
    training: { examples: number; labels: Record<string, number> };
    validation: { examples: number; correct: number; accuracy: number };
    classes: Array<{ label: string; trainingExamples: number }>;
  } | null;
};
type DraftHeroTrainingStatus = {
  available: boolean;
  model?: {
    heroCount: number;
    trainedAt: string;
    validation: { examples: number; correct: number; accuracy: number; description: string };
    officialSkinHeads?: { imageCount: number; heroCount: number };
    skinValidation?: { examples: number; correct: number; accuracy: number; description: string };
    replayValidation?: { examples: number; correct: number; accepted: number; accuracy: number; description: string };
  } | null;
};
type UltralyticsStatus = {
  packageAvailable: boolean;
  modelAvailable: boolean;
  managedRuntime: boolean;
  inferenceBackend?: {
    selected: string;
    onnxRuntime?: { directmlAvailable: boolean; providers: string[] };
    warning: string;
  };
  device?: {
    selected: string;
    type: string;
    name: string | null;
    cudaAvailable: boolean;
    torchVersion: string | null;
    warning: string;
  };
  classes: string[];
  training: { images: number; labels: number };
  validation: { images: number; labels: number };
};
type DinoIdentityStatus = {
  model: string;
  torchAvailable: boolean;
  indexed: boolean;
  references: { draft: number; liveMinimap: number; heroes: number };
};
type TimerOcrStatus = {
  packageAvailable: boolean;
  paddleAvailable: boolean;
  labelledTimerBoxes: number;
  transcribedTimerBoxes: number;
};
type RuntimeStatus = {
  exists: boolean;
  heroCount: number;
  updatedAt: string | null;
};
type SkinSignatureStatus = {
  compiledAt?: string;
  portraitCount: number;
  referenceCount: number;
};

function compactTime(value?: string) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

function OfficialMetric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="rounded-lg bg-white/5 p-3">
    <span className="text-xs uppercase text-slate-400">{label}</span>
    <div className="mt-1 min-w-0 break-words text-sm font-semibold leading-tight text-white">{value}</div>
    {detail ? <div className="mt-1 min-w-0 break-words text-xs leading-tight text-slate-400">{detail}</div> : null}
  </div>;
}

export function DataSync() {
  const [authorization, setAuthorization] = useState("");
  const [rank, setRank] = useState("101");
  const [matchType, setMatchType] = useState(0);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncError, setSyncError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [skinSignatures, setSkinSignatures] = useState<SkinSignatureStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [adbStatus, setAdbStatus] = useState<AdbAssetStatus | null>(null);
  const [adbBusy, setAdbBusy] = useState<"draft" | "vision" | "ui" | null>(null);
  const [adbError, setAdbError] = useState("");
  const [screenTraining, setScreenTraining] = useState<ScreenTrainingStatus | null>(null);
  const [screenTrainingBusy, setScreenTrainingBusy] = useState(false);
  const [screenTrainingError, setScreenTrainingError] = useState("");
  const [heroTraining, setHeroTraining] = useState<DraftHeroTrainingStatus | null>(null);
  const [heroTrainingBusy, setHeroTrainingBusy] = useState(false);
  const [ultralytics, setUltralytics] = useState<UltralyticsStatus | null>(null);
  const [ultralyticsBusy, setUltralyticsBusy] = useState<"install" | "train" | null>(null);
  const [dinoIdentity, setDinoIdentity] = useState<DinoIdentityStatus | null>(null);
  const [dinoBusy, setDinoBusy] = useState(false);
  const [timerOcr, setTimerOcr] = useState<TimerOcrStatus | null>(null);
  const [timerOcrBusy, setTimerOcrBusy] = useState(false);

  async function loadOfficialStatus() {
    try {
      const [runtimeResponse, signatureResponse] = await Promise.all([
        getRuntimeStatus(),
        getSkinSignatureStatus().catch(() => null),
      ]);
      setRuntimeStatus(runtimeResponse as RuntimeStatus);
      if (signatureResponse?.data) setSkinSignatures(signatureResponse.data as SkinSignatureStatus);
      setSyncError("");
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadAdbStatus() {
    try {
      const response = await getAdbAssetStatus();
      setAdbStatus(response.data as AdbAssetStatus);
      setAdbError("");
    } catch (error) {
      setAdbError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadScreenTrainingStatus() {
    try {
      const [screenResponse, heroResponse, yoloResponse, dinoResponse, timerOcrResponse] = await Promise.all([getScreenStateTrainingStatus(), getDraftHeroModelStatus(), getUltralyticsStatus(), getDinoIdentityStatus(), getTimerOcrStatus()]);
      setScreenTraining(screenResponse.data as ScreenTrainingStatus);
      setHeroTraining(heroResponse.data as DraftHeroTrainingStatus);
      setUltralytics(yoloResponse.data as UltralyticsStatus);
      setDinoIdentity(dinoResponse.data as DinoIdentityStatus);
      setTimerOcr(timerOcrResponse.data as TimerOcrStatus);
      setScreenTrainingError("");
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadOfficialStatus();
    void loadAdbStatus();
    void loadScreenTrainingStatus();
  }, []);

  const texturePreviews = useMemo(() => (adbStatus?.manifest?.extraction.bundles ?? [])
    .flatMap((bundle) => bundle.textures)
    .filter((texture) => /head|hero|skill|battle|map/i.test(texture.file))
    .sort((left, right) => Number(!left.name.startsWith("HeroHead")) - Number(!right.name.startsWith("HeroHead")))
    .slice(0, 6), [adbStatus]);
  const officialHeroCount = syncResult?.runtime?.heroes ?? runtimeStatus?.heroCount ?? "-";
  const officialUpdatedAt = syncResult?.runtime?.updatedAt ?? syncResult?.generatedAt ?? runtimeStatus?.updatedAt ?? "";
  const heroDetail = syncResult?.synced?.heroDirectory ? "Directory synced" : officialUpdatedAt ? `Cached ${compactTime(officialUpdatedAt)}` : "Awaiting sync";
  const metaValue = syncResult?.synced?.heroMeta ? "Synced" : runtimeStatus?.exists ? "Cached" : "-";
  const visionReferenceCount = syncResult?.visionSignatures?.referenceCount ?? skinSignatures?.referenceCount ?? "-";
  const visionPortraitCount = syncResult?.visionSignatures?.portraitCount ?? skinSignatures?.portraitCount;
  const visionDetail = visionPortraitCount ? `${visionPortraitCount} portraits` : skinSignatures?.compiledAt ? `Cached ${compactTime(skinSignatures.compiledAt)}` : "Portrait signatures";

  async function sync() {
    setBusy(true);
    setSyncError("");
    setSyncMessage(authorization.trim() ? "Syncing official MLBB data..." : "Syncing with local MLBB_GMS_AUTHORIZATION...");
    try {
      const result = await apiPost<any>("/api/sync/official", { authorization: authorization.trim(), rank, matchType, lang: "en" });
      setSyncResult(result);
      setRuntimeStatus({ exists: true, heroCount: Number(result.runtime?.heroes ?? 0), updatedAt: result.runtime?.updatedAt ?? result.generatedAt ?? null });
      if (result.visionSignatures) setSkinSignatures(result.visionSignatures as SkinSignatureStatus);
      setSyncMessage(`Official data synced at ${compactTime(result.generatedAt)}.`);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      setSyncMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function syncGameAssets(scope: "draft" | "vision" | "ui") {
    setAdbBusy(scope);
    setAdbError("");
    try {
      const response = await syncAdbAssets(scope);
      setAdbStatus((current) => ({
        ...(current ?? { ok: true, device: "", versionName: "", targetCount: 0 }),
        ok: true,
        manifest: response.data,
        versionName: response.data.versionName,
        device: response.data.device,
      }));
    } catch (error) {
      setAdbError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdbBusy(null);
    }
  }

  async function trainScreenModel() {
    setScreenTrainingBusy(true);
    setScreenTrainingError("");
    try {
      const response = await trainScreenStateModel();
      setScreenTraining({ available: true, model: response.data });
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      setScreenTrainingBusy(false);
    }
  }

  async function trainHeroModel() {
    setHeroTrainingBusy(true);
    setScreenTrainingError("");
    try {
      const response = await trainDraftHeroModel();
      setHeroTraining({ available: true, model: response.data });
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      setHeroTrainingBusy(false);
    }
  }

  async function installYoloRuntime() {
    setUltralyticsBusy("install");
    setScreenTrainingError("");
    try {
      const response = await installUltralyticsRuntime();
      setUltralytics(response.data as UltralyticsStatus);
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      setUltralyticsBusy(null);
    }
  }

  async function trainYoloModel() {
    setUltralyticsBusy("train");
    setScreenTrainingError("");
    try {
      const response = await trainUltralyticsModel({ baseModel: "yolo26n.pt", epochs: 60, imageSize: 960 });
      setUltralytics(response.data as UltralyticsStatus);
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      setUltralyticsBusy(null);
    }
  }

  async function buildDinoIndex() {
    setDinoBusy(true);
    setScreenTrainingError("");
    try {
      const response = await indexDinoReferences();
      setDinoIdentity(response.data as DinoIdentityStatus);
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      setDinoBusy(false);
    }
  }

  async function installTimerOcr() {
    setTimerOcrBusy(true);
    setScreenTrainingError("");
    try {
      const response = await installTimerOcrRuntime();
      setTimerOcr(response.data as TimerOcrStatus);
    } catch (error) {
      setScreenTrainingError(error instanceof Error ? error.message : String(error));
    } finally {
      setTimerOcrBusy(false);
    }
  }

  return <div className="space-y-4">
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><Database className="h-5 w-5 text-cyan-300" />Official Data</h3>
          <p className="text-sm text-slate-400">Heroes, roles, lanes, meta stats, patches, and portrait references.</p>
        </div>
        <button className="btn inline-flex items-center gap-2" disabled={busy} onClick={sync}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Syncing" : "Sync"}
        </button>
      </div>
      {syncMessage && <p className="flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm text-cyan-100"><CheckCircle2 className="h-4 w-4 shrink-0" />{syncMessage}</p>}
      {syncError && <p className="flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{syncError}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <OfficialMetric label="Token Source" value={authorization.trim() ? "Pasted" : "Local Env"} detail={authorization.trim() ? "This sync only" : "MLBB_GMS_AUTHORIZATION"} />
        <OfficialMetric label="Heroes" value={officialHeroCount} detail={heroDetail} />
        <OfficialMetric label="Meta Stats" value={metaValue} detail={`Rank ${rank} / Type ${matchType}`} />
        <OfficialMetric label="Vision Refs" value={visionReferenceCount} detail={visionDetail} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <details className="rounded-lg border border-white/10 bg-black/20 p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-200"><KeyRound className="h-4 w-4 text-cyan-300" />Credentials</summary>
          <label className="mt-3 block text-sm">GMS authorization token<input className="input mt-2 w-full" type="password" value={authorization} onChange={(e) => setAuthorization(e.target.value)} placeholder="Paste token or leave blank for local env" /></label>
          <p className="mt-2 text-xs text-slate-400">Blank uses the backend env token; expired tokens show a refresh message.</p>
        </details>
        <details className="rounded-lg border border-white/10 bg-black/20 p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-200"><SlidersHorizontal className="h-4 w-4 text-cyan-300" />Sync Options</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Rank bracket<input className="input mt-2 w-full" value={rank} onChange={(e) => setRank(e.target.value)} /></label>
            <label className="block text-sm">Match type<input className="input mt-2 w-full" type="number" value={matchType} onChange={(e) => setMatchType(Number(e.target.value))} /></label>
          </div>
        </details>
      </div>
      {syncResult && <details className="rounded-lg border border-white/10 bg-black/20 p-3">
        <summary className="cursor-pointer text-sm font-bold text-slate-200">Raw sync response</summary>
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-200">{JSON.stringify(syncResult, null, 2)}</pre>
      </details>}
    </section>

    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><Smartphone className="h-5 w-5 text-cyan-300" />ADB Game Assets</h3>
          <p className="text-sm text-slate-400">Draft, hero, spell, battle, and minimap Unity references from the connected MLBB install.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn inline-flex items-center gap-2" disabled={Boolean(adbBusy) || adbStatus?.ok === false} onClick={() => void syncGameAssets("draft")}>
            <RefreshCw className={`h-4 w-4 ${adbBusy === "draft" ? "animate-spin" : ""}`} />
            {adbBusy === "draft" ? "Extracting" : "Index Draft Assets"}
          </button>
          <button className="btn inline-flex items-center gap-2" disabled={Boolean(adbBusy) || adbStatus?.ok === false} onClick={() => void syncGameAssets("vision")}>
            <RefreshCw className={`h-4 w-4 ${adbBusy === "vision" ? "animate-spin" : ""}`} />
            {adbBusy === "vision" ? "Indexing CV" : "Index CV Surfaces"}
          </button>
          <button className="btn inline-flex items-center gap-2" disabled={Boolean(adbBusy) || adbStatus?.ok === false} onClick={() => void syncGameAssets("ui")}>
            <RefreshCw className={`h-4 w-4 ${adbBusy === "ui" ? "animate-spin" : ""}`} />
            {adbBusy === "ui" ? "Downloading UI" : "Download Full UI"}
          </button>
        </div>
      </div>

      {adbError && <p className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{adbError}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Device</span><div className="mt-1 truncate text-sm font-semibold">{adbStatus?.ok ? "Connected" : "Unavailable"}</div></div>
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">MLBB</span><div className="mt-1 truncate text-sm font-semibold">{adbStatus?.versionName || "-"}</div></div>
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">{adbStatus?.manifest?.scope === "draft" ? "Draft Index" : "CV Index"}</span><div className="mt-1 text-sm font-semibold">{adbStatus?.manifest?.bundles.length ?? 0} / {adbStatus?.manifest?.scope === "draft" ? adbStatus?.manifest?.inventory?.draftBundles : adbStatus?.manifest?.inventory?.visionBundles ?? adbStatus?.targetCount ?? 0}</div></div>
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Textures</span><div className="mt-1 text-sm font-semibold">{adbStatus?.manifest?.extraction.textures ?? 0}</div></div>
      </div>

      {adbStatus?.manifest && <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Full UI Library</span><div className="mt-1 text-sm font-semibold">{adbStatus.manifest.library?.uiDownloaded ?? 0} / {adbStatus.manifest.inventory?.uiBundles ?? "-"} bundles</div></div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Installed UI Size</span><div className="mt-1 text-sm font-semibold">{adbStatus.manifest.inventory ? `${(adbStatus.manifest.inventory.uiBytes / 1024 / 1024).toFixed(1)} MB` : "-"}</div></div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Draft Effects</span><div className="mt-1 text-sm font-semibold">{adbStatus.manifest.inventory?.draftArtBundles ?? "-"} Art bundles</div></div>
        </div>
        {adbStatus.manifest.inventory?.coverage && <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {adbStatus.manifest.inventory.coverage.map((surface) => <div className="rounded-lg bg-white/5 px-3 py-2" key={surface.surface}>
            <span className="text-xs uppercase text-slate-400">{surface.surface}</span>
            <div className="text-sm font-semibold">{surface.total} bundles</div>
          </div>)}
        </div>}
        <div className="flex flex-wrap gap-2">
          {adbStatus.manifest.bundles.slice(0, 18).map((bundle) => <span className="chip" key={bundle.id}>{bundle.category}: {bundle.file}</span>)}
          {adbStatus.manifest.bundles.length > 18 && <span className="chip">+{adbStatus.manifest.bundles.length - 18} indexed bundles</span>}
        </div>
        {texturePreviews.length > 0 && <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {texturePreviews.map((texture) => <figure key={texture.file} className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
            <img className="aspect-square w-full object-contain" src={`/api/sync/adb-assets/texture/${texture.file}`} alt="" />
            <figcaption className="flex items-center gap-1 truncate px-2 py-2 text-xs text-slate-300"><Image className="h-3 w-3 shrink-0" />{texture.name}</figcaption>
          </figure>)}
        </div>}
      </div>}
    </section>

    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold"><BrainCircuit className="h-5 w-5 text-cyan-300" />CV Model Training</h3>
          <p className="text-sm text-slate-400">Replay-labeled screen-state classifier for draft, loading, and live HUD recognition.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn inline-flex items-center gap-2" disabled={screenTrainingBusy || heroTrainingBusy} onClick={() => void trainScreenModel()}>
            <RefreshCw className={`h-4 w-4 ${screenTrainingBusy ? "animate-spin" : ""}`} />
            {screenTrainingBusy ? "Training" : "Train Screen States"}
          </button>
          <button className="btn inline-flex items-center gap-2" disabled={screenTrainingBusy || heroTrainingBusy} onClick={() => void trainHeroModel()}>
            <RefreshCw className={`h-4 w-4 ${heroTrainingBusy ? "animate-spin" : ""}`} />
            {heroTrainingBusy ? "Compiling" : "Train Draft Heroes"}
          </button>
        </div>
      </div>
      {screenTrainingError && <p className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{screenTrainingError}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Model</span><div className="mt-1 text-sm font-semibold">{screenTraining?.available ? "Ready" : "Not trained"}</div></div>
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Train Frames</span><div className="mt-1 text-sm font-semibold">{screenTraining?.model?.training.examples ?? "-"}</div></div>
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Validation</span><div className="mt-1 text-sm font-semibold">{screenTraining?.model ? `${screenTraining.model.validation.correct} / ${screenTraining.model.validation.examples}` : "-"}</div></div>
        <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Accuracy</span><div className="mt-1 text-sm font-semibold">{screenTraining?.model ? `${Math.round(screenTraining.model.validation.accuracy * 100)}%` : "-"}</div></div>
      </div>
      {screenTraining?.model?.classes && <div className="flex flex-wrap gap-2">
        {screenTraining.model.classes.map((entry) => <span className="chip" key={entry.label}>{entry.label.replace(/_/g, " ")}: {entry.trainingExamples}</span>)}
      </div>}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Draft Hero Model</span><div className="mt-1 text-sm font-semibold">{heroTraining?.available ? "Ready" : "Not trained"}</div></div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Official Heroes</span><div className="mt-1 text-sm font-semibold">{heroTraining?.model?.heroCount ?? "-"}</div></div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Official Skin Heads</span><div className="mt-1 text-sm font-semibold">{heroTraining?.model?.officialSkinHeads?.imageCount ?? "-"}</div><div className="text-xs text-slate-400">{heroTraining?.model?.officialSkinHeads ? `${heroTraining.model.officialSkinHeads.heroCount} heroes` : ""}</div></div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3"><span className="text-xs uppercase text-slate-400">Skin Check</span><div className="mt-1 text-sm font-semibold">{heroTraining?.model?.skinValidation ? `${heroTraining.model.skinValidation.correct} / ${heroTraining.model.skinValidation.examples}` : "-"}</div></div>
      </div>
      <div className="rounded-lg border border-cyan-300/15 bg-cyan-400/5 p-3">
        <span className="text-xs uppercase text-cyan-200">Recorded Final Draft Proof</span>
        <div className="mt-1 text-sm font-semibold text-white">
          {heroTraining?.model?.replayValidation
            ? `${heroTraining.model.replayValidation.correct} / ${heroTraining.model.replayValidation.examples} confirmed rail identities`
            : "Not validated"}
        </div>
        <p className="mt-1 text-xs text-slate-400">Human-labelled finalized draft crops matched against official installed-game skin heads.</p>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs uppercase text-cyan-200">Ultralytics YOLO Detection</span>
            <div className="mt-1 text-sm font-semibold text-white">
              {ultralytics?.modelAvailable ? "Trained model ready" : ultralytics?.packageAvailable ? "Runtime ready, labels required" : "Runtime not installed"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={Boolean(ultralyticsBusy)} onClick={() => void installYoloRuntime()}>
              {ultralyticsBusy === "install" ? "Installing" : "Install YOLO Runtime"}
            </button>
            <button className="btn" disabled={Boolean(ultralyticsBusy) || !ultralytics?.packageAvailable || !ultralytics.training.labels} onClick={() => void trainYoloModel()}>
              {ultralyticsBusy === "train" ? "Training" : "Train YOLO Model"}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Runtime</span><div className="mt-1 text-sm font-semibold">{ultralytics?.managedRuntime ? "Managed" : "Not installed"}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Model</span><div className="mt-1 text-sm font-semibold">{ultralytics?.modelAvailable ? "Ready" : "Missing"}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Accelerator</span><div className="mt-1 truncate text-sm font-semibold">{ultralytics?.inferenceBackend?.selected === "directml" ? "DirectML GPU" : ultralytics?.device?.type === "cuda" ? "CUDA GPU" : ultralytics?.device?.type?.toUpperCase() ?? "CPU"}</div><div className="truncate text-xs text-slate-400">{ultralytics?.inferenceBackend?.selected === "directml" ? "AMD / DirectX 12" : ultralytics?.device?.name ?? ultralytics?.device?.selected ?? "-"}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Train Labels</span><div className="mt-1 text-sm font-semibold">{ultralytics?.training.labels ?? 0}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Validation Labels</span><div className="mt-1 text-sm font-semibold">{ultralytics?.validation.labels ?? 0}</div></div>
        </div>
        {ultralytics?.classes?.length ? <div className="mt-3 flex flex-wrap gap-2">
          {ultralytics.classes.map((label) => <span className="chip" key={label}>{label.replace(/_/g, " ")}</span>)}
        </div> : null}
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs uppercase text-cyan-200">DINOv2 Identity Matching</span>
            <div className="mt-1 text-sm font-semibold text-white">{dinoIdentity?.indexed ? "Reference index ready" : dinoIdentity?.torchAvailable ? "References not indexed" : "Runtime unavailable"}</div>
          </div>
          <button className="btn" disabled={dinoBusy || !dinoIdentity?.torchAvailable} onClick={() => void buildDinoIndex()}>
            {dinoBusy ? "Indexing" : "Build DINO Index"}
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Model</span><div className="mt-1 text-sm font-semibold">{dinoIdentity?.model ?? "dinov2_vits14"}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Draft References</span><div className="mt-1 text-sm font-semibold">{dinoIdentity?.references.draft ?? 0}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Minimap References</span><div className="mt-1 text-sm font-semibold">{dinoIdentity?.references.liveMinimap ?? 0}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Heroes Covered</span><div className="mt-1 text-sm font-semibold">{dinoIdentity?.references.heroes ?? 0}</div></div>
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-xs uppercase text-cyan-200">Timer OCR</span>
            <div className="mt-1 text-sm font-semibold text-white">{timerOcr?.packageAvailable && timerOcr?.paddleAvailable ? "Reader ready" : "Runtime not installed"}</div>
          </div>
          {!timerOcr?.packageAvailable || !timerOcr?.paddleAvailable
            ? <button className="btn" disabled={timerOcrBusy} onClick={() => void installTimerOcr()}>{timerOcrBusy ? "Installing" : "Install Timer OCR"}</button>
            : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Runtime</span><div className="mt-1 text-sm font-semibold">{timerOcr?.paddleAvailable ? "PaddleOCR" : "Missing"}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Timer Boxes</span><div className="mt-1 text-sm font-semibold">{timerOcr?.labelledTimerBoxes ?? 0}</div></div>
          <div className="rounded-lg bg-white/5 p-3"><span className="text-xs uppercase text-slate-400">Transcripts</span><div className="mt-1 text-sm font-semibold">{timerOcr?.transcribedTimerBoxes ?? 0}</div></div>
        </div>
      </div>
    </section>
  </div>;
}
