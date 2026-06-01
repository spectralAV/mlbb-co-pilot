import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Boxes, Database, Film, RefreshCw, ScanSearch, Trash2, Wand2 } from "lucide-react";
import {
  apiUrl,
  deleteCvAnnotation,
  getCvAnnotationClasses,
  getCvAnnotations,
  getUltralyticsStatus,
  syncCvAnnotations,
  trainUltralyticsModel,
} from "../api/client";
import { cpuTrainingBlocked, cpuTrainingDisabledMessage, trainingDeviceDetail, trainingDeviceLabel, trainingUnavailable } from "../utils/cvTraining";

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

    <nav className="cv-inspector-tabs">
      <StudioTab to="/cv-studio" end icon={<Database size={16} />}>Dataset</StudioTab>
      <StudioTab to="/cv-studio/video" icon={<Film size={16} />}>Video Review</StudioTab>
      <StudioTab to="/cv-studio/frame" icon={<ScanSearch size={16} />}>Frame Annotator</StudioTab>
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

  useEffect(() => {
    void refresh();
  }, []);

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

  const trainingBlocked = cpuTrainingBlocked(model) || trainingUnavailable(model);

  async function refresh() {
    const [classResult, annotationResult, modelResult] = await Promise.allSettled([
      getCvAnnotationClasses(),
      getCvAnnotations(),
      getUltralyticsStatus(),
    ]);
    if (classResult.status === "fulfilled") setClasses(classResult.value.data ?? []);
    if (annotationResult.status === "fulfilled") setSamples(annotationResult.value.data ?? []);
    if (modelResult.status === "fulfilled") setModel(modelResult.value.data ?? modelResult.value);
    if ([classResult, annotationResult, modelResult].every((result) => result.status === "rejected")) {
      setMessage("CV dataset status is unavailable.");
    }
  }

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
    const quick = scope === "correction";
    setBusy(quick ? "quick-train" : "full-train");
    setMessage(quick ? "Quick fine-tune is training recent manual corrections." : "Full training is rebuilding from the active dataset.");
    try {
      await syncCvAnnotations();
      const result = await trainUltralyticsModel(quick
        ? { trainingScope: "correction", epochs: 8, imageSize: 640, batch: 4, recentLimit: 32, repeatManual: 8 }
        : { trainingScope: "full", epochs: 30, imageSize: 960, batch: 4 });
      setModel(result.data ?? result);
      await refresh();
      setMessage(quick ? "Quick fine-tune complete." : "Full training complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Training failed.");
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
        <button className="btn inline-flex items-center gap-2" disabled={Boolean(busy) || !model?.packageAvailable || trainingBlocked} onClick={() => void train("correction")}>
          <Wand2 size={16} />{busy === "quick-train" ? "Fine-tuning..." : "Quick Fine-Tune"}
        </button>
      </div>
    </section>

    <section className="cv-metrics-grid">
      <StudioMetric label="Active Dataset" value={`${model?.training?.images ?? 0} train / ${model?.validation?.images ?? 0} val`} detail={`${sampleStats.trainFrames + sampleStats.valFrames} saved manual frames`} />
      <StudioMetric label="Saved Labels" value={String(sampleStats.boxes)} detail={`${sampleStats.trainFrames} train frames / ${sampleStats.valFrames} val frames`} />
      <StudioMetric label="Training" value={trainingDeviceLabel(model)} detail={trainingDeviceDetail(model)} />
      <StudioMetric label="Inference" value={model?.inferenceBackend?.selected === "directml" ? "DirectML ONNX" : model?.device?.type?.toUpperCase() ?? "Unknown"} detail={model?.onnxModelAvailable ? "ONNX export available" : "ONNX export missing"} />
      <StudioMetric label="Model" value={model?.modelAvailable ? "Weights loaded" : "No weights"} detail={model?.weights?.split(/[\\/]/).pop() ?? "-"} />
      <StudioMetric label="Classes" value={String(classes.length)} detail="Ultralytics label set" />
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(520px,1fr)_420px]">
      <div className="cv-video-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black"><Database className="h-5 w-5 text-cyan-300" />Dataset Editor</h3>
            <p className="mt-1 text-sm text-slate-400">Saved annotation frames that can be synced, filtered, inspected, or deleted.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>
            <button className="cv-control-button" disabled={Boolean(busy)} onClick={() => void syncDataset()}><Database size={15} />Sync</button>
            <button className="cv-control-button" disabled={Boolean(busy) || !model?.packageAvailable || trainingBlocked} onClick={() => void train("full")}>Full Train</button>
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
            {filteredSamples.length ? filteredSamples.map((sample) => <article key={sample.id} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-3 md:grid-cols-[120px_1fr_auto]">
              <a className="block overflow-hidden rounded bg-black" href={apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`)} target="_blank" rel="noreferrer" style={{ aspectRatio: `${sample.width || 16} / ${sample.height || 9}` }}>
                <img src={apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`)} alt="" className="h-full w-full object-cover" loading="lazy" />
              </a>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">{sample.split}</span>
                  <span className="text-xs text-slate-500">{formatDate(sample.createdAt)}</span>
                </div>
                <div className="mt-2 truncate text-sm font-bold text-white">{sample.source}</div>
                <div className="mt-1 text-xs text-slate-400">{sample.width}x{sample.height} / {sample.boxes.length} labels</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {sample.boxes.slice(0, 8).map((box, index) => <span key={`${sample.id}-${index}`} className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {(classMap.get(box.classId)?.name ?? `class ${box.classId}`).replace(/_/g, " ")}
                  </span>)}
                  {sample.boxes.length > 8 ? <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-500">+{sample.boxes.length - 8}</span> : null}
                </div>
              </div>
              <button title="Delete sample" className="self-start rounded p-2 text-rose-200 hover:bg-white/10 disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void removeSample(sample.id)}>
                <Trash2 size={16} />
              </button>
            </article>) : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">No saved annotation frames match the current filter.</div>}
          </div>
        </div>
      </div>

      <aside className="cv-inspector-panel">
        <div className="border-b border-white/10 p-4">
          <h3 className="flex items-center gap-2 text-lg font-black"><Boxes className="h-5 w-5 text-cyan-300" />Class Balance</h3>
          <p className="mt-1 text-sm text-slate-400">Manual saved labels only. Active imported data is larger and handled by the full dataset builder.</p>
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

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}
