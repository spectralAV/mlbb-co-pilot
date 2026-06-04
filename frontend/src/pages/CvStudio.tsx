import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Boxes, Clapperboard, Database, Film, Pencil, RefreshCw, ScanSearch, ScanText, Trash2, Wand2 } from "lucide-react";
import {
  apiUrl,
  deleteCvAnnotation,
  exportUltralyticsOnnx,
  getCvAnnotationClasses,
  getCvAnnotations,
  getCvDatasetQuality,
  getUltralyticsStatus,
  syncCvAnnotations,
} from "../api/client";
import { cpuTrainingBlocked, cpuTrainingDisabledMessage, trainingDeviceDetail, trainingDeviceLabel, trainingUnavailable } from "../utils/cvTraining";
import { useUltralyticsTrainingJob } from "../utils/useUltralyticsTrainingJob";

type LabelClass = { id: number; name: string; group: string };
type AnnotationBox = { classId: number; rect: [number, number, number, number]; heroId?: number; heroName?: string; transcript?: string };
type AnnotationSample = {
  id: string;
  split: "train" | "val";
  source: string;
  width: number;
  height: number;
  boxes: AnnotationBox[];
  createdAt: string;
  origin?: "manual" | "active";
};

type ClassStat = {
  id: number;
  name: string;
  group: string;
  train: number;
  val: number;
};

export function CvStudio() {
  return <div className="cv-page">
    <header className="cv-hero">
      <div className="min-w-0">
        <div className="mb-5 flex items-center gap-3 text-xs font-bold uppercase text-slate-500">
          <span>Tactical operations</span>
          <span>/</span>
          <span className="text-cyan-300">CV Studio</span>
        </div>
        <h2>CV Studio</h2>
        <p className="mt-4 max-w-3xl text-base text-slate-400">One workspace for video review, frame annotation, dataset cleanup, and model training.</p>
      </div>
    </header>

    <nav className="cv-studio-tabs touch-scroll">
      <StudioTab to="/cv-studio" end icon={<Database size={16} />}>Dataset</StudioTab>
      <StudioTab to="/cv-studio/editor" icon={<Boxes size={16} />}><span className="cv-studio-label-full">Model Editor</span><span className="cv-studio-label-short">Editor</span></StudioTab>
      <StudioTab to="/cv-studio/ocr" icon={<ScanText size={16} />}><span className="cv-studio-label-full">HUD OCR</span><span className="cv-studio-label-short">OCR</span></StudioTab>
      <StudioTab to="/cv-studio/video" icon={<Film size={16} />}><span className="cv-studio-label-full">Video Review</span><span className="cv-studio-label-short">Video</span></StudioTab>
      <StudioTab to="/cv-studio/batch-review" icon={<Clapperboard size={16} />}><span className="cv-studio-label-full">Batch Review</span><span className="cv-studio-label-short">Batch</span></StudioTab>
      <StudioTab to="/cv-studio/frame" icon={<ScanSearch size={16} />}><span className="cv-studio-label-full">Frame Annotator</span><span className="cv-studio-label-short">Frame</span></StudioTab>
    </nav>

    <Outlet />
  </div>;
}

export function CvStudioDataset() {
  const [classes, setClasses] = useState<LabelClass[]>([]);
  const [samples, setSamples] = useState<AnnotationSample[]>([]);
  const [model, setModel] = useState<any>(null);
  const [split, setSplit] = useState<"all" | "train" | "val">("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Dataset editor is ready.");
  const [busy, setBusy] = useState("");
  const [datasetQuality, setDatasetQuality] = useState<any>(null);

  async function refresh() {
    const [classResult, annotationResult, modelResult, qualityResult] = await Promise.allSettled([
      getCvAnnotationClasses(),
      getCvAnnotations(),
      getUltralyticsStatus(),
      getCvDatasetQuality(),
    ]);
    if (classResult.status === "fulfilled") setClasses(classResult.value.data ?? []);
    if (annotationResult.status === "fulfilled") setSamples(annotationResult.value.data ?? []);
    if (modelResult.status === "fulfilled") setModel(modelResult.value.data ?? modelResult.value);
    if (qualityResult.status === "fulfilled") setDatasetQuality(qualityResult.value.data ?? qualityResult.value);
    if ([classResult, annotationResult, modelResult].every((result) => result.status === "rejected")) {
      setMessage("CV dataset status is unavailable.");
    }
  }

  const {
    trainingJob,
    trainingActive,
    trainingBusy: hookTrainingBusy,
    startTraining,
    stopTraining: requestStopTraining,
  } = useUltralyticsTrainingJob({
    onMessage: setMessage,
    onCompleted: async () => {
      setBusy("");
      await refresh();
    },
    busyKeys: ["quick-train", "full-train", "stop-train"],
  });

  const trainingBusy = hookTrainingBusy || busy === "quick-train" || busy === "full-train";

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const state = trainingJob?.state;
    if (!state || state === "starting" || state === "training" || state === "validating" || state === "exporting" || state === "mirroring" || state === "cleanup") return;
    if (busy === "quick-train" || busy === "full-train") setBusy("");
  }, [trainingJob?.state, busy]);

  const classMap = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const sampleStats = useMemo(() => {
    const trainFrames = samples.filter((sample) => sample.split === "train").length;
    const valFrames = samples.filter((sample) => sample.split === "val").length;
    const boxes = samples.reduce((sum, sample) => sum + sample.boxes.length, 0);
    return { trainFrames, valFrames, boxes };
  }, [samples]);
  const classStats = useMemo(() => {
    const stats = new Map<number, ClassStat>();
    for (const item of classes) stats.set(item.id, { id: item.id, name: item.name, group: item.group, train: 0, val: 0 });
    for (const sample of samples) {
      for (const box of sample.boxes) {
        const row = stats.get(box.classId) ?? {
          id: box.classId,
          name: classMap.get(box.classId)?.name ?? `class ${box.classId}`,
          group: classMap.get(box.classId)?.group ?? "Other",
          train: 0,
          val: 0,
        };
        row[sample.split] += 1;
        stats.set(box.classId, row);
      }
    }
    return [...stats.values()].sort((left, right) => (right.train + right.val) - (left.train + left.val));
  }, [classMap, classes, samples]);
  const filteredSamples = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return samples.filter((sample) => {
      if (split !== "all" && sample.split !== split) return false;
      if (!needle) return true;
      return sample.source.toLowerCase().includes(needle) || sample.id.toLowerCase().includes(needle);
    });
  }, [query, samples, split]);
  const visibleSamples = useMemo(() => filteredSamples.slice(0, 320), [filteredSamples]);

  const trainingBlocked = cpuTrainingBlocked(model) || trainingUnavailable(model);

  async function syncDataset() {
    setBusy("sync");
    try {
      const result = await syncCvAnnotations();
      await refresh();
      setMessage(`Synced ${result.data?.samples ?? samples.length} saved annotation samples into the active dataset.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dataset sync failed.");
    } finally {
      setBusy("");
    }
  }

  async function train(scope: "correction" | "full") {
    if (trainingBlocked) {
      setMessage(cpuTrainingDisabledMessage);
      return;
    }
    if (trainingBusy) {
      setMessage("A training job is already running.");
      return;
    }
    const quick = scope === "correction";
    setBusy(quick ? "quick-train" : "full-train");
    setMessage(quick ? "Starting quick fine-tune for recent manual corrections." : "Starting full training from the active dataset.");
    try {
      await syncCvAnnotations();
      await startTraining(quick
        ? { trainingScope: "correction", epochs: 8, imageSize: 640, batch: 4, recentLimit: 32, repeatManual: 8 }
        : { trainingScope: "full", epochs: 30, imageSize: 960, batch: 4 });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Training failed to start.");
      setBusy("");
    }
  }

  async function stopTraining() {
    setBusy("stop-train");
    try {
      await requestStopTraining();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop training.");
    } finally {
      setBusy("");
    }
  }

  async function exportOnnx() {
    if (trainingBusy) {
      setMessage("Wait for training to finish before exporting ONNX.");
      return;
    }
    setBusy("export-onnx");
    try {
      const response = await exportUltralyticsOnnx();
      setModel(response.data ?? response);
      await refresh();
      setMessage("ONNX export complete for DirectML inference.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ONNX export failed.");
    } finally {
      setBusy("");
    }
  }

  async function removeSample(id: string) {
    setBusy(`delete-${id}`);
    try {
      await deleteCvAnnotation(id);
      await refresh();
      setMessage("Annotation sample deleted from saved and active datasets.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete annotation sample.");
    } finally {
      setBusy("");
    }
  }

  return <>
    <section className="flex flex-wrap items-center justify-between gap-3">
      <div className="cv-status-strip min-w-[280px] flex-1">{message}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn inline-flex items-center gap-2" disabled={trainingBusy || !model?.packageAvailable || trainingBlocked} onClick={() => void train("correction")}>
          <Wand2 size={16} />{busy === "quick-train" ? "Fine-tuning..." : "Quick Fine-Tune"}
        </button>
        {trainingActive || trainingJob?.state === "stuck" ? (
          <button className="btn inline-flex items-center gap-2 border-rose-400/30 bg-rose-500/15 text-rose-100" disabled={Boolean(busy)} onClick={() => void stopTraining()}>
            Stop Training
          </button>
        ) : null}
        <button className="btn inline-flex items-center gap-2" disabled={trainingBusy || !model?.modelAvailable} onClick={() => void exportOnnx()}>
          {busy === "export-onnx" ? "Exporting ONNX..." : "Export ONNX"}
        </button>
      </div>
    </section>

    {trainingJob && trainingJob.state !== "idle" ? (
      <section className={`rounded-xl border p-4 text-sm ${trainingJob.state === "stuck" ? "border-amber-400/30 bg-amber-500/10 text-amber-50" : "border-white/10 bg-white/[0.03] text-slate-300"}`}>
        {trainingJob.state === "stuck" ? (
          <p className="mb-3 text-xs leading-relaxed text-amber-100/90">
            Training is stuck. Stop the job to release WSL GPU, then start a new run after reviewing dataset quality.
          </p>
        ) : null}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <div><span className="text-slate-500">State</span><div className="font-bold text-white">{trainingJob.state}</div></div>
          <div><span className="text-slate-500">PID</span><div className="font-bold text-white">{trainingJob.pid ?? "-"}</div></div>
          <div><span className="text-slate-500">Elapsed</span><div className="font-bold text-white">{formatElapsed(trainingJob.elapsedMs)}</div></div>
          <div><span className="text-slate-500">Scope</span><div className="font-bold text-white">{trainingJob.trainingScope ?? "-"}</div></div>
          <div className="md:col-span-2"><span className="text-slate-500">Runtime</span><div className="font-bold text-white">{trainingJob.runtime ?? "-"} · {trainingJob.trainingPython?.split("/").pop() ?? "-"}</div></div>
          <div className="md:col-span-2"><span className="text-slate-500">Artifacts</span><div className="truncate font-bold text-white">{trainingJob.artifactPaths?.weights ?? "-"}</div></div>
          <div className="md:col-span-2"><span className="text-slate-500">Staged workspace</span><div className="truncate font-bold text-white">{trainingJob.stagedWorkspace ?? "none"}</div></div>
          <div className="md:col-span-2"><span className="text-slate-500">Run path</span><div className="truncate font-bold text-white">{trainingJob.runPath ?? "-"}</div></div>
          {trainingJob.wsl?.linuxPids?.length ? (
            <div className="md:col-span-2 xl:col-span-4"><span className="text-slate-500">WSL PIDs</span><div className="font-bold text-white">{trainingJob.wsl.linuxPids.join(", ")}</div></div>
          ) : null}
        </div>
      </section>
    ) : null}

    <section className="cv-metrics-grid">
      <StudioMetric label="Active Dataset" value={`${model?.training?.images ?? 0} train / ${model?.validation?.images ?? 0} val`} detail={`${sampleStats.trainFrames + sampleStats.valFrames} editable frames`} />
      <StudioMetric label="Saved Labels" value={String(sampleStats.boxes)} detail={`${sampleStats.trainFrames} train frames / ${sampleStats.valFrames} val frames`} />
      <StudioMetric label="Training" value={trainingDeviceLabel(model)} detail={trainingDeviceDetail(model)} />
      <StudioMetric label="Inference" value={model?.inferenceBackend?.selected === "directml" ? "DirectML ONNX" : model?.device?.type?.toUpperCase() ?? "Unknown"} detail={model?.onnxModelAvailable ? "ONNX export available" : "ONNX export missing"} />
      <StudioMetric label="Model" value={model?.modelAvailable ? "Weights loaded" : "No weights"} detail={model?.weights?.split(/[\\/]/).pop() ?? "-"} />
      <StudioMetric label="Classes" value={String(classes.length)} detail="Ultralytics label set" />
      <StudioMetric
        label="Draft slot IoU"
        value={typeof datasetQuality?.draftMeanSlotIoU === "number" ? datasetQuality.draftMeanSlotIoU.toFixed(3) : "—"}
        detail={datasetQuality?.hints?.[0] ?? (datasetQuality?.gaps?.missingValClasses?.length ? `${datasetQuality.gaps.missingValClasses.length} classes lack val` : "Run cv:analyze for dataset report")}
      />
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(520px,1fr)_420px]">
      <div className="cv-video-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black"><Database className="h-5 w-5 text-cyan-300" />Dataset Editor</h3>
            <p className="mt-1 text-sm text-slate-400">Active train/val frames plus manual corrections that can be filtered, inspected, edited, or deleted.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void syncDataset()}><Database size={15} />Sync</button>
            <button className="cv-control-button" disabled={trainingBusy || !model?.packageAvailable || trainingBlocked} onClick={() => void train("full")}>Full Train</button>
          </div>
        </div>
        <div className="grid gap-3 border-b border-white/10 p-4 md:grid-cols-[160px_1fr]">
          <select className="input min-h-10 py-1 text-sm" value={split} onChange={(event) => setSplit(event.target.value as "all" | "train" | "val")}>
            <option value="all">All splits</option>
            <option value="train">Training</option>
            <option value="val">Validation</option>
          </select>
          <input className="input min-h-10 py-1 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by source or sample id" />
        </div>
        <div className="touch-scroll max-h-[560px] overflow-auto p-4">
          <div className="grid gap-3">
            {filteredSamples.length > visibleSamples.length ? <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-3 text-xs font-semibold text-cyan-50">
              Showing {visibleSamples.length} of {filteredSamples.length} matches. Search by source/id or filter split to narrow the active dataset.
            </div> : null}
            {visibleSamples.length ? visibleSamples.map((sample) => <article key={sample.id} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 md:grid-cols-[120px_1fr_auto]">
              <a className="block overflow-hidden rounded bg-black" href={apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`)} target="_blank" rel="noreferrer" style={{ aspectRatio: `${sample.width || 16} / ${sample.height || 9}` }}>
                <img src={apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`)} alt="" className="h-full w-full object-cover" loading="lazy" />
              </a>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">{sample.split}</span>
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase text-slate-300">{sample.origin ?? "manual"}</span>
                  <span className="text-xs text-slate-500">{formatDate(sample.createdAt)}</span>
                </div>
                <div className="mt-2 truncate text-sm font-bold text-white">{sample.source}</div>
                <div className="mt-1 text-xs text-slate-400">{sample.width && sample.height ? `${sample.width}x${sample.height}` : "image"} / {sample.boxes.length} labels</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {sample.boxes.slice(0, 8).map((box, index) => <span key={`${sample.id}-${index}`} className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {(classMap.get(box.classId)?.name ?? `class ${box.classId}`).replace(/_/g, " ")}
                  </span>)}
                  {sample.boxes.length > 8 ? <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-500">+{sample.boxes.length - 8}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 self-start md:flex-col">
                <NavLink className="cv-control-button min-h-9 justify-center" to={`/cv-studio/editor?sample=${encodeURIComponent(sample.id)}`}>
                  <Pencil size={15} />Edit
                </NavLink>
                <button title="Delete sample" className="rounded p-2 text-rose-200 hover:bg-white/10 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void removeSample(sample.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </article>) : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">No dataset frames match the current filter.</div>}
          </div>
        </div>
      </div>

      <aside className="cv-inspector-panel">
        <div className="border-b border-white/10 p-4">
          <h3 className="flex items-center gap-2 text-lg font-black"><Boxes className="h-5 w-5 text-cyan-300" />Class Balance</h3>
          <p className="mt-1 text-sm text-slate-400">Class counts include active train/val data and manual correction frames.</p>
        </div>
        <div className="touch-scroll max-h-[720px] overflow-auto p-4">
          <div className="space-y-2">
            {classStats.map((row) => {
              const total = row.train + row.val;
              return <div key={row.id} className={`rounded-lg border p-3 ${total ? "border-white/10 bg-white/[0.035]" : "border-white/5 bg-transparent opacity-55"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-white">{row.name.replace(/_/g, " ")}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase text-slate-500">{row.group}</div>
                  </div>
                  <div className="text-right text-sm font-black text-cyan-100">{total}</div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
                  <span>Train <b className="text-slate-100">{row.train}</b></span>
                  <span>Val <b className="text-slate-100">{row.val}</b></span>
                </div>
              </div>;
            })}
          </div>
        </div>
      </aside>
    </section>
  </>;
}

function StudioTab({ to, end, icon, children }: { to: string; end?: boolean; icon: ReactNode; children: ReactNode }) {
  return <NavLink
    to={to}
    end={end}
    className={({ isActive }) => `cv-inspector-tab inline-flex items-center gap-2 ${isActive ? "cv-inspector-tab-active" : ""}`}
  >
    {icon}
    {children}
  </NavLink>;
}

function StudioMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric-card">
    <div className="min-w-0">
      <div className="cv-rail-label">{label}</div>
      <div className="metric-card-value mt-1">{value}</div>
      <div className="metric-card-detail">{detail}</div>
    </div>
  </div>;
}

function formatElapsed(value: number | undefined) {
  const ms = Number(value ?? 0);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}
