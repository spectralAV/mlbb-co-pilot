import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Check, Database, ImagePlus, Play, RefreshCw, Save, ScanSearch, Search, Trash2, Wand2 } from "lucide-react";
import {
  apiUrl,
  deleteCvAnnotation,
  getCvAnnotationClasses,
  getCvAnnotations,
  getHeroRecognitionManifest,
  getUltralyticsStatus,
  inferUltralyticsFrame,
  saveCvAnnotation,
  syncCvAnnotations,
  trainUltralyticsModel,
  updateCvAnnotation,
} from "../api/client";
import { normalizeReviewRect, type NormalizedRect } from "../utils/cvGeometry";
import { cpuTrainingBlocked, cpuTrainingDisabledMessage, trainingDeviceDetail, trainingDeviceLabel, trainingUnavailable } from "../utils/cvTraining";

type LabelClass = { id: number; name: string; group: string };
type HeroOption = { id: number; name: string };
type Rect = NormalizedRect;
type AnnotationBox = { classId: number; rect: Rect; heroId?: number; heroName?: string; transcript?: string };
type AnnotationSample = {
  id: string;
  split: "train" | "val";
  source: string;
  width: number;
  height: number;
  boxes: AnnotationBox[];
  createdAt: string;
  updatedAt?: string;
};
type EditorBox = AnnotationBox & {
  id: string;
  confidence?: number;
  suggested?: boolean;
  source?: "manual" | "model";
};
type BoxDragState = { id: string; mode: "move" | "resize"; origin: { x: number; y: number }; initial: Rect };

const defaultImageSize = { width: 16, height: 9 };

export function CvModelEditor() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageUrlRef = useRef("");
  const [classes, setClasses] = useState<LabelClass[]>([]);
  const [heroes, setHeroes] = useState<HeroOption[]>([]);
  const [samples, setSamples] = useState<AnnotationSample[]>([]);
  const [model, setModel] = useState<any>(null);
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState(defaultImageSize);
  const [source, setSource] = useState("manual-frame");
  const [split, setSplit] = useState<"train" | "val">("train");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [activeClassId, setActiveClassId] = useState(0);
  const [boxes, setBoxes] = useState<EditorBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState("");
  const [confidence, setConfidence] = useState(0.45);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);
  const [message, setMessage] = useState("Model editor is ready.");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void refresh();
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, []);

  const classMap = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const groupedClasses = useMemo(() => {
    const groups = new Map<string, LabelClass[]>();
    for (const item of classes) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    return [...groups.entries()];
  }, [classes]);
  const selectedSample = useMemo(() => samples.find((sample) => sample.id === selectedSampleId) ?? null, [samples, selectedSampleId]);
  const normalizedBoxes = useMemo(() => boxes.flatMap((box) => {
    const normalized = sanitizeEditorBox(box);
    return normalized ? [normalized] : [];
  }), [boxes]);
  const selectedBox = normalizedBoxes.find((box) => box.id === selectedBoxId) ?? null;
  const acceptedCount = normalizedBoxes.filter((box) => !box.suggested).length;
  const pendingCount = normalizedBoxes.length - acceptedCount;
  const trainingBlocked = cpuTrainingBlocked(model) || trainingUnavailable(model);
  const filteredSamples = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const targetClass = classFilter === "all" ? null : Number(classFilter);
    return samples.filter((sample) => {
      if (needle && !`${sample.source} ${sample.id}`.toLowerCase().includes(needle)) return false;
      if (targetClass != null && !sample.boxes.some((box) => box.classId === targetClass)) return false;
      return true;
    });
  }, [classFilter, query, samples]);
  const classBalance = useMemo(() => {
    const rows = new Map<number, { label: string; train: number; val: number }>();
    for (const item of classes) rows.set(item.id, { label: item.name, train: 0, val: 0 });
    for (const sample of samples) {
      for (const box of sample.boxes) {
        const row = rows.get(box.classId) ?? { label: `class ${box.classId}`, train: 0, val: 0 };
        row[sample.split] += 1;
        rows.set(box.classId, row);
      }
    }
    return [...rows.entries()]
      .map(([id, row]) => ({ id, ...row, total: row.train + row.val }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 12);
  }, [classes, samples]);
  const dragPreview: Rect | null = start && cursor ? [
    Math.min(start.x, cursor.x),
    Math.min(start.y, cursor.y),
    Math.abs(start.x - cursor.x),
    Math.abs(start.y - cursor.y),
  ] : null;

  async function refresh() {
    const classTask = getCvAnnotationClasses().then((result) => {
      const nextClasses = result.data ?? [];
      setClasses(nextClasses);
      setActiveClassId((current) => nextClasses.some((item: LabelClass) => item.id === current) ? current : nextClasses[0]?.id ?? 0);
      return true;
    }).catch(() => false);
    const sampleTask = getCvAnnotations().then((result) => {
      const nextSamples = result.data ?? [];
      setSamples(nextSamples);
      return true;
    }).catch(() => false);
    void getUltralyticsStatus().then((result) => {
      setModel(result.data ?? result);
    }).catch(() => undefined);
    const heroTask = getHeroRecognitionManifest().then((result) => {
      const nextHeroes = (result.data?.heroes ?? [])
        .map((hero: any) => ({ id: Number(hero.id), name: String(hero.name ?? "").trim() }))
        .filter((hero: HeroOption) => Number.isInteger(hero.id) && Boolean(hero.name))
        .sort((left: HeroOption, right: HeroOption) => left.name.localeCompare(right.name));
      setHeroes(nextHeroes);
      return true;
    }).catch(() => false);
    const results = await Promise.all([classTask, sampleTask, heroTask]);
    if (results.every((result) => !result)) {
      setMessage("CV model editor status is unavailable.");
    }
  }

  async function openSample(sample: AnnotationSample, announce = true) {
    setBusy("open");
    try {
      const response = await fetch(apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load annotation image.");
      await loadImage(await response.blob(), {
        source: sample.source,
        split: sample.split,
        selectedSampleId: sample.id,
        boxes: sample.boxes.map((box, index) => ({
          id: `${sample.id}-${index}`,
          ...box,
          source: "manual",
        })),
      });
      if (announce) setMessage(`Loaded ${sample.source} with ${sample.boxes.length} labels.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open sample.");
    } finally {
      setBusy("");
    }
  }

  async function importFrame(file: File) {
    await loadImage(file, {
      source: file.name,
      split: "train",
      selectedSampleId: "",
      boxes: [],
    });
    setMessage(`${file.name} imported. Draw labels or run detection, then save it into the dataset.`);
  }

  async function loadImage(blob: Blob, options: { source: string; split: "train" | "val"; selectedSampleId: string; boxes: EditorBox[] }) {
    const bitmap = await createImageBitmap(blob);
    setImageSize({ width: bitmap.width, height: bitmap.height });
    bitmap.close();
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const nextUrl = URL.createObjectURL(blob);
    imageUrlRef.current = nextUrl;
    setImageBlob(blob);
    setImageUrl(nextUrl);
    setSource(options.source);
    setSplit(options.split);
    setSelectedSampleId(options.selectedSampleId);
    setBoxes(options.boxes.flatMap((box) => {
      const normalized = sanitizeEditorBox(box);
      return normalized ? [normalized] : [];
    }));
    setSelectedBoxId("");
    setStart(null);
    setCursor(null);
    setBoxDrag(null);
  }

  function point(event: PointerEvent<HTMLElement>) {
    const board = boardRef.current;
    if (!board) return { x: 0, y: 0 };
    const rect = board.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function beginDraw(event: PointerEvent<HTMLElement>) {
    if (!imageBlob || boxDrag) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event);
    setStart(next);
    setCursor(next);
  }

  function finishDraw(event: PointerEvent<HTMLElement>) {
    if (boxDrag) {
      finishBoxDrag(point(event));
      return;
    }
    if (!start) return;
    const end = point(event);
    const rect = normalizeReviewRect([
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(start.x - end.x),
      Math.abs(start.y - end.y),
    ]);
    if (rect) {
      const id = `manual-${Date.now()}`;
      setBoxes((current) => [...current, { id, classId: activeClassId, rect, source: "manual" }]);
      setSelectedBoxId(id);
    }
    setStart(null);
    setCursor(null);
  }

  function beginBoxDrag(event: PointerEvent<HTMLElement>, box: EditorBox, mode: BoxDragState["mode"]) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedBoxId(box.id);
    setStart(null);
    setCursor(null);
    setBoxDrag({ id: box.id, mode, origin: point(event), initial: box.rect });
  }

  function updateBoxDrag(next: { x: number; y: number }) {
    if (!boxDrag) return;
    const rect = draggedRect(boxDrag, next);
    setBoxes((current) => current.map((box) => box.id === boxDrag.id ? { ...box, rect } : box));
  }

  function finishBoxDrag(next: { x: number; y: number }) {
    updateBoxDrag(next);
    setBoxDrag(null);
  }

  function updateBoxClass(id: string, classId: number) {
    const nextName = classMap.get(classId)?.name ?? "";
    setBoxes((current) => current.map((box) => {
      if (box.id !== id) return box;
      const previousName = classMap.get(box.classId)?.name ?? "";
      return {
        ...box,
        classId,
        heroId: isHeroMarkerClass(nextName) && isHeroMarkerClass(previousName) ? box.heroId : undefined,
        heroName: isHeroMarkerClass(nextName) && isHeroMarkerClass(previousName) ? box.heroName : undefined,
        transcript: isTranscriptClass(nextName) && isTranscriptClass(previousName) ? box.transcript : undefined,
      };
    }));
  }

  function updateBoxHero(id: string, heroId: number) {
    const hero = heroes.find((item) => item.id === heroId);
    setBoxes((current) => current.map((box) => box.id === id ? { ...box, heroId: hero?.id, heroName: hero?.name } : box));
  }

  function updateBoxRectPart(id: string, index: 0 | 1 | 2 | 3, rawValue: number) {
    if (!Number.isFinite(rawValue)) return;
    setBoxes((current) => current.map((box) => {
      if (box.id !== id) return box;
      const next: Rect = [...box.rect] as Rect;
      next[index] = rawValue / 100;
      const rect = normalizeReviewRect(next);
      return rect ? { ...box, rect } : box;
    }));
  }

  function removeBox(id: string) {
    setBoxes((current) => current.filter((box) => box.id !== id));
    if (selectedBoxId === id) setSelectedBoxId("");
  }

  async function runDetection() {
    if (!imageBlob) return;
    setBusy("detect");
    try {
      const result = await inferUltralyticsFrame(imageBlob, confidence);
      const detections = result.data?.detections ?? [];
      const suggestions = detections.flatMap((detection: any, index: number) => {
        const rect = normalizeReviewRect(detection.bbox);
        const classId = Number(detection.classId);
        if (!rect || !Number.isInteger(classId)) return [];
        return [{
          id: `model-${Date.now()}-${index}`,
          classId,
          rect,
          confidence: Number(detection.confidence),
          suggested: true,
          source: "model" as const,
        }];
      });
      setModel(result.data ?? result);
      setBoxes((current) => [...current.filter((box) => !box.suggested), ...suggestions]);
      setSelectedBoxId("");
      setMessage(suggestions.length ? `${suggestions.length} model suggestions added for review.` : "No model suggestions met the current threshold.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Detection failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveCurrent() {
    if (!imageBlob) return;
    const payload = {
      split,
      source,
      allowEmpty: true,
      boxes: normalizedBoxes.filter((box) => !box.suggested).map(toAnnotationBox),
    };
    setBusy("save");
    try {
      if (selectedSample) {
        const result = await updateCvAnnotation(selectedSample.id, payload);
        await refresh();
        setMessage(`Updated ${result.data?.id ?? selectedSample.id} with ${payload.boxes.length} accepted labels.`);
      } else {
        const result = await saveCvAnnotation(imageBlob, payload);
        await refresh();
        setSelectedSampleId(result.data?.id ?? "");
        setMessage(`Saved new dataset frame with ${payload.boxes.length} accepted labels.`);
      }
      setBoxes((current) => current.filter((box) => !box.suggested));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy("");
    }
  }

  async function deleteSelectedSample() {
    if (!selectedSample) return;
    setBusy("delete");
    try {
      await deleteCvAnnotation(selectedSample.id);
      setSelectedSampleId("");
      setImageBlob(null);
      setImageUrl("");
      setBoxes([]);
      await refresh();
      setMessage("Dataset frame deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy("");
    }
  }

  async function quickFineTune() {
    if (trainingBlocked) {
      setMessage(cpuTrainingDisabledMessage);
      return;
    }
    setBusy("train");
    setMessage("Saving dataset sync and quick fine-tuning recent corrections.");
    try {
      await syncCvAnnotations();
      const result = await trainUltralyticsModel({ trainingScope: "correction", epochs: 8, imageSize: 640, batch: 4, recentLimit: 32, repeatManual: 8 });
      setModel(result.data ?? result);
      await refresh();
      setMessage("Quick fine-tune complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quick fine-tune failed.");
    } finally {
      setBusy("");
    }
  }

  return <div className="cv-tool-embedded space-y-4">
    <section className="cv-tool-toolbar">
      <div className="min-w-0">
        <h3>Model Editor</h3>
        <p>Review dataset frames, correct bounded boxes, accept model suggestions, and fine-tune the local detector.</p>
      </div>
      <div className="cv-tool-actions">
        <button className="cv-ghost-button inline-flex items-center gap-2" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}><ImagePlus size={16} />Import Frame</button>
        <button className="btn inline-flex items-center gap-2" disabled={!imageBlob || Boolean(busy)} onClick={() => void saveCurrent()}><Save size={16} />Save</button>
        <button className="btn inline-flex items-center gap-2" disabled={Boolean(busy) || trainingBlocked} onClick={() => void quickFineTune()}><Play size={16} />{busy === "train" ? "Fine-tuning..." : "Quick Fine-Tune"}</button>
        <input ref={fileRef} className="hidden" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFrame(file); event.currentTarget.value = ""; }} />
      </div>
    </section>

    <div className="cv-status-strip">{message}</div>

    <section className="cv-metrics-grid">
      <Metric label="Dataset" value={`${model?.training?.images ?? 0} train / ${model?.validation?.images ?? 0} val`} detail={`${samples.length} saved frames`} />
      <Metric label="Selected" value={selectedSample ? selectedSample.split.toUpperCase() : imageBlob ? "New Frame" : "None"} detail={source || "-"} />
      <Metric label="Labels" value={`${acceptedCount} accepted`} detail={`${pendingCount} pending / ${normalizedBoxes.length} visible boxes`} />
      <Metric label="Training" value={trainingDeviceLabel(model)} detail={trainingDeviceDetail(model)} />
      <Metric label="Inference" value={model?.inferenceBackend?.selected === "directml" ? "DirectML GPU" : model?.device?.type?.toUpperCase() ?? "Unknown"} detail={model?.onnxModelAvailable ? "ONNX export available" : "YOLO runtime"} />
      <Metric label="Classes" value={String(classes.length)} detail="Local detector labels" />
    </section>

    <section className="cv-editor-grid">
      <aside className="cv-video-panel cv-editor-sidebar">
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-black"><Database className="h-5 w-5 text-cyan-300" />Dataset Frames</h3>
            <button title="Refresh" className="rounded p-2 text-slate-300 hover:bg-white/10" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={16} /></button>
          </div>
          <label className="mt-3 flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3">
            <Search className="h-4 w-4 text-slate-500" />
            <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search frames" />
          </label>
          <select className="input mt-2 min-h-10 py-1 text-sm" value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
            <option value="all">All classes</option>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="touch-scroll max-h-[620px] space-y-2 overflow-auto p-3">
          {filteredSamples.length ? filteredSamples.map((sample) => <button
            key={sample.id}
            className={`cv-editor-frame-row ${sample.id === selectedSampleId ? "cv-editor-frame-row-active" : ""}`}
            onClick={() => void openSample(sample)}
          >
            <span className="block overflow-hidden rounded bg-black" style={{ aspectRatio: `${sample.width || 16} / ${sample.height || 9}` }}>
              <img src={apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`)} alt="" className="h-full w-full object-cover" loading="lazy" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-xs font-bold text-white">{sample.source}</span>
              <span className="mt-1 block text-[11px] uppercase text-slate-500">{sample.split} / {sample.boxes.length} labels</span>
            </span>
          </button>) : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">No dataset frames match the current filters.</div>}
        </div>
      </aside>

      <main className="cv-video-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black"><ScanSearch className="h-5 w-5 text-cyan-300" />Annotation Canvas</h3>
            <p className="mt-1 text-sm text-slate-400">Draw, move, resize, classify, and accept only the labels you trust.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="cv-control-button" disabled={!imageBlob || Boolean(busy)} onClick={() => void runDetection()}><Wand2 size={15} />Run Detection</button>
            <button className="cv-control-button" disabled={!pendingCount || Boolean(busy)} onClick={() => setBoxes((current) => current.map((box) => ({ ...box, suggested: false, source: "manual" })))}><Check size={15} />Accept All</button>
            <button className="cv-control-button" disabled={!normalizedBoxes.length || Boolean(busy)} onClick={() => setBoxes([])}><Trash2 size={15} />Clear</button>
          </div>
        </div>
        <div
          ref={boardRef}
          className="cv-editor-canvas"
          style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
          onPointerDown={beginDraw}
          onPointerMove={(event) => boxDrag ? updateBoxDrag(point(event)) : start ? setCursor(point(event)) : undefined}
          onPointerUp={finishDraw}
        >
          {imageUrl ? <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} /> : <div className="grid h-full min-h-96 place-items-center text-sm text-slate-400">Import or select a dataset frame</div>}
          {normalizedBoxes.map((box) => {
            const name = classMap.get(box.classId)?.name ?? `class ${box.classId}`;
            const active = selectedBoxId === box.id;
            return <div
              key={box.id}
              role="button"
              tabIndex={0}
              className={`cv-editor-box ${box.suggested ? "cv-editor-box-suggested" : boxClassColor(name)} ${active ? "cv-editor-box-active" : ""}`}
              style={{ left: `${box.rect[0] * 100}%`, top: `${box.rect[1] * 100}%`, width: `${box.rect[2] * 100}%`, height: `${box.rect[3] * 100}%` }}
              onPointerDown={(event) => beginBoxDrag(event, box, "move")}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedBoxId(box.id); }}
            >
              <span className="cv-editor-box-label">{name.replace(/_/g, " ")}{box.confidence != null ? ` ${Math.round(box.confidence * 100)}%` : ""}</span>
              <span className="cv-editor-resize-handle" onPointerDown={(event) => beginBoxDrag(event, box, "resize")} />
            </div>;
          })}
          {dragPreview ? <div className="absolute border-2 border-emerald-300 bg-emerald-400/10" style={{ left: `${dragPreview[0] * 100}%`, top: `${dragPreview[1] * 100}%`, width: `${dragPreview[2] * 100}%`, height: `${dragPreview[3] * 100}%` }} /> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4 text-xs text-slate-400">
          <span>{imageUrl ? `${imageSize.width}x${imageSize.height}` : "No frame"} / normalized coordinates</span>
          <label className="flex min-w-64 items-center gap-3">
            <span className="font-bold uppercase text-slate-500">Confidence</span>
            <span className="font-black text-cyan-200">{confidence.toFixed(2)}</span>
            <input className="min-w-0 flex-1 accent-cyan-300" type="range" min={0.1} max={0.9} step={0.05} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
          </label>
        </div>
      </main>

      <aside className="space-y-4">
        <section className="cv-inspector-panel p-4">
          <h3 className="flex items-center gap-2 text-lg font-black"><Boxes className="h-5 w-5 text-cyan-300" />Selected Box</h3>
          {selectedBox ? <>
            <label className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
              Class
              <select className="input mt-1 min-h-10 w-full py-1 text-sm normal-case" value={selectedBox.classId} onChange={(event) => updateBoxClass(selectedBox.id, Number(event.target.value))}>
                {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {isHeroMarkerClass(classMap.get(selectedBox.classId)?.name ?? "") ? <label className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
              Hero identity
              <select className="input mt-1 min-h-10 w-full py-1 text-sm normal-case" value={selectedBox.heroId ?? ""} onChange={(event) => updateBoxHero(selectedBox.id, Number(event.target.value))}>
                <option value="">Unassigned</option>
                {heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}
              </select>
            </label> : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {["X", "Y", "W", "H"].map((label, index) => <label key={label} className="text-[11px] font-bold uppercase text-slate-400">
                {label}
                <input className="input mt-1 min-h-9 py-1 text-sm" type="number" min={0} max={100} step={0.05} value={(selectedBox.rect[index] * 100).toFixed(2)} onChange={(event) => updateBoxRectPart(selectedBox.id, index as 0 | 1 | 2 | 3, Number(event.target.value))} />
              </label>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="cv-control-button" disabled={!selectedBox.suggested} onClick={() => setBoxes((current) => current.map((box) => box.id === selectedBox.id ? { ...box, suggested: false, source: "manual" } : box))}><Check size={15} />Accept</button>
              <button className="cv-control-button cv-control-danger" onClick={() => removeBox(selectedBox.id)}><Trash2 size={15} />Delete</button>
            </div>
          </> : <p className="mt-3 rounded-lg bg-white/[0.04] p-3 text-sm text-slate-400">Select a box or draw a new one on the canvas.</p>}
        </section>

        <section className="cv-inspector-panel p-4">
          <h3 className="text-lg font-black">Frame Settings</h3>
          <label className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
            Source label
            <input className="input mt-1 min-h-10 w-full py-1 text-sm normal-case" value={source} onChange={(event) => setSource(event.target.value)} />
          </label>
          <label className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
            Split
            <select className="input mt-1 min-h-10 w-full py-1 text-sm normal-case" value={split} onChange={(event) => setSplit(event.target.value as "train" | "val")}>
              <option value="train">Training</option>
              <option value="val">Validation</option>
            </select>
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn min-h-10 justify-center" disabled={!imageBlob || Boolean(busy)} onClick={() => void saveCurrent()}><Save size={15} />Save</button>
            <button className="cv-control-button cv-control-danger min-h-10 justify-center" disabled={!selectedSample || Boolean(busy)} onClick={() => void deleteSelectedSample()}><Trash2 size={15} />Delete Frame</button>
          </div>
        </section>

        <section className="cv-inspector-panel overflow-hidden">
          <div className="border-b border-white/10 p-4">
            <h3 className="text-lg font-black">Classes</h3>
            <p className="mt-1 text-sm text-slate-400">Choose the active draw class.</p>
          </div>
          <div className="touch-scroll max-h-[360px] space-y-4 overflow-auto p-3">
            {groupedClasses.map(([group, items]) => <div key={group}>
              <div className="mb-2 text-xs font-bold uppercase text-slate-500">{group}</div>
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => <button key={item.id} className={`min-h-9 rounded border px-2 py-2 text-left text-xs font-semibold ${activeClassId === item.id ? "border-cyan-300 bg-cyan-500/20 text-cyan-50" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`} onClick={() => setActiveClassId(item.id)}>{item.name.replace(/_/g, " ")}</button>)}
              </div>
            </div>)}
          </div>
        </section>

        <section className="cv-inspector-panel p-4">
          <h3 className="text-lg font-black">Class Balance</h3>
          <div className="mt-3 space-y-2">
            {classBalance.map((row) => <div key={row.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-bold">{row.label.replace(/_/g, " ")}</span>
                <span className="font-black text-cyan-100">{row.total}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 text-xs text-slate-400">
                <span>Train {row.train}</span>
                <span>Val {row.val}</span>
              </div>
            </div>)}
          </div>
        </section>
      </aside>
    </section>
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric-card">
    <div className="min-w-0">
      <div className="cv-rail-label">{label}</div>
      <div className="metric-card-value mt-1">{value}</div>
      <div className="metric-card-detail">{detail}</div>
    </div>
  </div>;
}

function toAnnotationBox(box: EditorBox): AnnotationBox {
  return {
    classId: box.classId,
    rect: normalizeReviewRect(box.rect) ?? box.rect,
    heroId: box.heroId,
    heroName: box.heroName,
    transcript: box.transcript,
  };
}

function sanitizeEditorBox(box: EditorBox): EditorBox | null {
  const rect = normalizeReviewRect(box.rect);
  if (!rect || !Number.isInteger(box.classId)) return null;
  const confidence = Number(box.confidence);
  return {
    ...box,
    rect,
    confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : undefined,
  };
}

function draggedRect(drag: BoxDragState, next: { x: number; y: number }): Rect {
  const [left, top, width, height] = drag.initial;
  const deltaX = next.x - drag.origin.x;
  const deltaY = next.y - drag.origin.y;
  const minSize = 0.002;
  if (drag.mode === "move") {
    return normalizeReviewRect([
      clamp(left + deltaX, 0, 1 - width),
      clamp(top + deltaY, 0, 1 - height),
      width,
      height,
    ]) ?? drag.initial;
  }
  return normalizeReviewRect([
    left,
    top,
    clamp(width + deltaX, minSize, 1 - left),
    clamp(height + deltaY, minSize, 1 - top),
  ]) ?? drag.initial;
}

function boxClassColor(name: string) {
  if (name.includes("enemy")) return "cv-editor-box-enemy";
  if (name.includes("ally")) return "cv-editor-box-ally";
  return "cv-editor-box-neutral";
}

function isHeroMarkerClass(name: string) {
  return name === "ally_hero_marker" || name === "enemy_hero_marker";
}

function isTranscriptClass(name: string) {
  return name.includes("respawn") || name.includes("counter") || name.includes("timer") || name.includes("kda");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
