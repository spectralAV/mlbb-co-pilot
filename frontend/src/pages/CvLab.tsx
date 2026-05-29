import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Camera, Check, Cpu, FileUp, Play, RefreshCw, ScanSearch, Trash2, Wand2 } from "lucide-react";
import {
  deleteCvAnnotation,
  apiUrl,
  getCvAnnotationClasses,
  getCvAnnotations,
  getHeroRecognitionManifest,
  getScreenOcrStatus,
  getTimerOcrStatus,
  getUltralyticsStatus,
  inferScreenOcrFrame,
  inferUltralyticsFrame,
  inferTimerCrop,
  installScreenOcrRuntime,
  installTimerOcrRuntime,
  saveCvAnnotation,
  syncCvAnnotations,
  trainUltralyticsModel,
} from "../api/client";
import { captureCurrentRuntimeFrame, captureSources, useCaptureRuntimeStore } from "../runtime/captureRuntime";

type LabelClass = { id: number; name: string; group: string };
type HeroOption = { id: number; name: string };
type Rect = [number, number, number, number];
type LabelBox = { id: string; classId: number; rect: Rect; confidence?: number; suggested?: boolean; heroId?: number; heroName?: string; transcript?: string };
type AnnotationSample = {
  id: string;
  split: "train" | "val";
  source: string;
  boxes: Array<{ classId: number; rect: Rect; heroId?: number; heroName?: string; transcript?: string }>;
  createdAt: string;
  width: number;
  height: number;
};

export function CvLab() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageUrlRef = useRef("");
  const [classes, setClasses] = useState<LabelClass[]>([]);
  const [heroes, setHeroes] = useState<HeroOption[]>([]);
  const [samples, setSamples] = useState<AnnotationSample[]>([]);
  const [model, setModel] = useState<any>(null);
  const [timerOcr, setTimerOcr] = useState<any>(null);
  const [screenOcr, setScreenOcr] = useState<any>(null);
  const [frame, setFrame] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 20, height: 9 });
  const [source, setSource] = useState("obs-native-frame");
  const [split, setSplit] = useState<"train" | "val">("train");
  const [activeClassId, setActiveClassId] = useState(18);
  const [boxes, setBoxes] = useState<LabelBox[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [message, setMessage] = useState("Waiting for frame.");
  const [busy, setBusy] = useState("");
  const running = useCaptureRuntimeStore((state) => state.running);
  const selectedSource = useCaptureRuntimeStore((state) => state.selectedSource);
  const sourceMode = useCaptureRuntimeStore((state) => state.sourceMode);
  const windowContentCrop = useCaptureRuntimeStore((state) => state.windowContentCrop);

  useEffect(() => {
    void refresh();
    return () => { if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current); };
  }, []);

  const classMap = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const acceptedCount = boxes.filter((box) => !box.suggested).length;
  const selectedCaptureSource = captureSources.find((item) => item.id === selectedSource) ?? captureSources[0];
  const groupedClasses = useMemo(() => {
    const groups = new Map<string, LabelClass[]>();
    for (const item of classes) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    return [...groups.entries()];
  }, [classes]);

  async function refresh() {
    const [classResult, annotationResult, modelResult, heroResult, timerResult, screenOcrResult] = await Promise.allSettled([
      getCvAnnotationClasses(),
      getCvAnnotations(),
      getUltralyticsStatus(),
      getHeroRecognitionManifest(),
      getTimerOcrStatus(),
      getScreenOcrStatus(),
    ]);
    if (classResult.status === "fulfilled") setClasses(classResult.value.data ?? []);
    if (annotationResult.status === "fulfilled") setSamples(annotationResult.value.data ?? []);
    if (modelResult.status === "fulfilled") setModel(modelResult.value.data ?? modelResult.value);
    if (heroResult.status === "fulfilled") {
      const nextHeroes = (heroResult.value.data?.heroes ?? [])
        .map((hero: any) => ({ id: Number(hero.id), name: String(hero.name ?? "").trim() }))
        .filter((hero: HeroOption) => Number.isInteger(hero.id) && Boolean(hero.name))
        .sort((left: HeroOption, right: HeroOption) => left.name.localeCompare(right.name));
      setHeroes(nextHeroes);
    }
    if (timerResult.status === "fulfilled") setTimerOcr(timerResult.value.data ?? null);
    if (screenOcrResult.status === "fulfilled") setScreenOcr(screenOcrResult.value.data ?? null);
    if ([classResult, annotationResult, modelResult, heroResult, timerResult, screenOcrResult].every((result) => result.status === "rejected")) {
      setMessage("CV dataset status is unavailable.");
    }
  }

  async function loadBlob(blob: Blob, label: string, existingBoxes: LabelBox[] = []) {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    setImageSize({ width, height });
    bitmap.close();
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const nextUrl = URL.createObjectURL(blob);
    imageUrlRef.current = nextUrl;
    setImageUrl(nextUrl);
    setFrame(blob);
    setSource(label);
    setBoxes(existingBoxes);
    setSelectedId("");
    setMessage(`${label} loaded at ${width}x${height}.`);
  }

  async function captureSelectedFrame() {
    setBusy("capture");
    try {
      const activeFrame = await captureCurrentRuntimeFrame();
      if (activeFrame) {
        await loadBlob(activeFrame.blob, `${activeFrame.source}-${activeFrame.mode}-frame`);
        return;
      }
      if (selectedSource === "obs") {
        const response = await fetch(apiUrl(`/api/capture/obs/frame?t=${Date.now()}`), { cache: "no-store" });
        if (!response.ok) throw new Error("No OBS bridge frame is available.");
        await loadBlob(await response.blob(), "obs-native-frame");
        return;
      }
      throw new Error(`${selectedCaptureSource.title} has no active frame.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Capture failed.");
    } finally {
      setBusy("");
    }
  }

  async function importFrame(file: File) {
    await loadBlob(file, file.name);
  }

  async function openSample(sample: AnnotationSample) {
    setBusy("sample");
    try {
      const response = await fetch(apiUrl(`/api/vision/annotations/${encodeURIComponent(sample.id)}/image`), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load labelled image.");
      setSplit(sample.split);
      await loadBlob(await response.blob(), sample.source, sample.boxes.map((box, index) => ({
        id: `${sample.id}-${index}`,
        classId: box.classId,
        rect: box.rect,
        heroId: box.heroId,
        heroName: box.heroName,
        transcript: box.transcript,
      })));
    } finally {
      setBusy("");
    }
  }

  function point(event: PointerEvent) {
    const rect = boardRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function addBox(end: { x: number; y: number }) {
    if (!start) return;
    const rect: Rect = [
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    ].map((value) => Number(value.toFixed(6))) as Rect;
    if (rect[2] > 0.002 && rect[3] > 0.002) {
      const id = `drawn-${Date.now()}`;
      setBoxes((current) => [...current, { id, classId: activeClassId, rect }]);
      setSelectedId(id);
    }
    setStart(null);
    setCursor(null);
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
    setBoxes((current) => current.map((box) => box.id === id
      ? { ...box, heroId: hero?.id, heroName: hero?.name }
      : box));
  }

  function updateBoxTranscript(id: string, transcript: string) {
    setBoxes((current) => current.map((box) => box.id === id ? { ...box, transcript } : box));
  }

  async function readTimerValue(box: LabelBox) {
    if (!frame) return;
    const timerType = classMap.get(box.classId)?.name ?? "";
    if (!isTranscriptClass(timerType)) return;
    setBusy("timer-ocr");
    try {
      const crop = await cropBlob(frame, box.rect);
      const result = await inferTimerCrop(crop, timerType);
      const text = String(result.data?.text ?? "").trim();
      if (text) {
        updateBoxTranscript(box.id, text);
        setMessage(`Timer OCR suggested ${text} at ${Math.round(Number(result.data?.confidence ?? 0) * 100)}%.`);
      } else {
        setMessage("Timer OCR found no readable digits in this crop.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Timer OCR failed.");
    } finally {
      setBusy("");
    }
  }

  async function installOcr() {
    setBusy("install-ocr");
    try {
      const [timerResult, screenResult] = await Promise.all([
        installTimerOcrRuntime(),
        installScreenOcrRuntime(),
      ]);
      setTimerOcr(timerResult.data);
      setScreenOcr(screenResult.data);
      setMessage("PaddleOCR runtime is available for timers and screen text.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PaddleOCR installation failed.");
    } finally {
      setBusy("");
    }
  }

  async function readScreenText() {
    if (!frame) return;
    setBusy("screen-ocr");
    try {
      const result = await inferScreenOcrFrame(frame, { maxRegions: 5 });
      const regions = (result.data?.regions ?? []).filter((item: any) => String(item?.text ?? "").trim());
      if (!regions.length) {
        setMessage("Screen OCR found no readable text in the calibrated regions.");
        return;
      }
      const summary = regions
        .slice(0, 3)
        .map((item: any) => `${String(item.region ?? "screen").replace(/_/g, " ")}: ${String(item.text ?? "").slice(0, 48)}`)
        .join(" / ");
      setMessage(`Screen OCR: ${summary}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Screen OCR failed.");
    } finally {
      setBusy("");
    }
  }

  async function suggestBoxes() {
    if (!frame) return;
    setBusy("suggest");
    try {
      const result = await inferUltralyticsFrame(frame, 0.25);
      const detections = result.data?.detections ?? [];
      const suggestions: LabelBox[] = detections.map((detection: any, index: number) => ({
        id: `model-${Date.now()}-${index}`,
        classId: Number(detection.classId),
        rect: detection.bbox as Rect,
        confidence: Number(detection.confidence),
        suggested: true,
      }));
      setBoxes((current) => [...current.filter((box) => !box.suggested), ...suggestions]);
      setMessage(`${suggestions.length} model suggestions pending review.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Prediction failed.");
    } finally {
      setBusy("");
    }
  }

  function acceptSuggestion(id: string) {
    setBoxes((current) => current.map((box) => box.id === id ? { ...box, suggested: false } : box));
  }

  async function saveCurrent() {
    if (!frame || acceptedCount === 0) return;
    setBusy("save");
    try {
      await saveCvAnnotation(frame, {
        split,
        source,
        boxes: boxes.filter((box) => !box.suggested).map((box) => ({
          classId: box.classId,
          rect: box.rect,
          heroId: box.heroId,
          heroName: box.heroName,
          transcript: box.transcript,
        })),
      });
      await refresh();
      setMessage(`Saved ${acceptedCount} labelled objects to the ${split} dataset.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saving failed.");
    } finally {
      setBusy("");
    }
  }

  async function removeSample(id: string) {
    await deleteCvAnnotation(id);
    await refresh();
    setMessage("Annotation sample removed from the active and source datasets.");
  }

  async function train() {
    setBusy("train");
    setMessage("Synchronizing labels and training at 960px. This can take several minutes.");
    try {
      await syncCvAnnotations();
      const result = await trainUltralyticsModel({ epochs: 30, imageSize: 960 });
      setModel(result.data ?? result);
      await refresh();
      setMessage("Training complete. Updated weights are ready for native OBS inference.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Training failed.");
    } finally {
      setBusy("");
    }
  }

  const drag: Rect | null = start && cursor ? [
    Math.min(start.x, cursor.x),
    Math.min(start.y, cursor.y),
    Math.abs(start.x - cursor.x),
    Math.abs(start.y - cursor.y),
  ] : null;

  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">CV Lab</h2>
        <p className="text-slate-400">Active-source annotation dataset</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn inline-flex items-center gap-2" disabled={Boolean(busy)} onClick={captureSelectedFrame}><Camera size={16} />Capture Source</button>
        <button className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-4 font-semibold hover:bg-white/10" onClick={() => fileRef.current?.click()}><FileUp className="mr-2 inline h-4 w-4" />Import Frame</button>
        <input ref={fileRef} className="hidden" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFrame(file); }} />
      </div>
    </header>

    <div className="rounded-lg border border-cyan-300/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">{message}</div>

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <Status label="Capture Source" value={selectedCaptureSource.title} detail={running ? `${sourceMode}${selectedSource === "window" && windowContentCrop.enabled ? " / cropped" : ""}` : "not running"} />
      <Status label="Model" value={model?.modelAvailable ? "Weights loaded" : "No model"} detail={model?.weights?.split(/[\\/]/).pop() ?? "-"} />
      <Status
        label="Accelerator"
        value={model?.inferenceBackend?.selected === "directml" ? "DirectML GPU" : model?.device?.type === "cuda" ? "CUDA GPU" : model?.device?.type?.toUpperCase() ?? "CPU"}
        detail={model?.inferenceBackend?.selected === "directml" ? "AMD / DirectX 12" : model?.device?.name ?? model?.device?.selected ?? "-"}
      />
      <Status label="Dataset" value={`${model?.training?.images ?? 0} train / ${model?.validation?.images ?? 0} val`} detail={`${samples.length} manually labelled frames`} />
      <Status label="Label Scope" value={`${classes.length} classes`} detail="Detection labels and timer ROI targets" />
      <Status label="Timer OCR" value={timerOcr?.packageAvailable && timerOcr?.paddleAvailable ? "Ready" : "Not installed"} detail={`${timerOcr?.transcribedTimerBoxes ?? 0} transcribed timer boxes`} />
      <Status label="Screen OCR" value={screenOcr?.packageAvailable && screenOcr?.paddleAvailable ? "Ready" : "Not installed"} detail={screenOcr?.enabledForLiveCapture ? "live gate enabled" : "manual test only"} />
    </section>

    <div className="grid gap-4 lg:grid-cols-[minmax(460px,1fr)_360px]">
      <section className="card self-start overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
          <div className="flex items-center gap-2 text-sm font-bold"><ScanSearch className="h-4 w-4 text-cyan-300" />Annotation Canvas</div>
          <div className="flex gap-2">
            <button className="min-h-9 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 text-sm font-semibold text-cyan-100" disabled={!frame || Boolean(busy)} onClick={suggestBoxes}><Wand2 className="mr-1 inline h-4 w-4" />Suggest</button>
            <button className="min-h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-semibold" disabled={!frame || !screenOcr?.packageAvailable || Boolean(busy)} onClick={() => void readScreenText()}><ScanSearch className="mr-1 inline h-4 w-4" />Read Text</button>
            <button className="min-h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-semibold" disabled={!boxes.length} onClick={() => setBoxes([])}><Trash2 className="mr-1 inline h-4 w-4" />Clear</button>
          </div>
        </div>
        <div
          ref={boardRef}
          className="relative select-none bg-black touch-none"
          style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
          onPointerDown={(event) => { if (!frame) return; event.currentTarget.setPointerCapture(event.pointerId); const next = point(event); setStart(next); setCursor(next); }}
          onPointerMove={(event) => { if (start) setCursor(point(event)); }}
          onPointerUp={(event) => addBox(point(event))}
        >
          {imageUrl ? <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} /> : <div className="grid h-full min-h-72 place-items-center text-sm text-slate-400">No frozen frame loaded</div>}
          {boxes.map((box) => {
            const active = box.id === selectedId;
            const name = classMap.get(box.classId)?.name ?? `class ${box.classId}`;
            return <button
              type="button"
              title={name}
              key={box.id}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); setSelectedId(box.id); }}
              className={`absolute border-2 text-left ${box.suggested ? "border-dashed border-amber-300 bg-amber-400/10" : "border-cyan-300 bg-cyan-400/10"} ${active ? "ring-2 ring-white" : ""}`}
              style={{ left: `${box.rect[0] * 100}%`, top: `${box.rect[1] * 100}%`, width: `${box.rect[2] * 100}%`, height: `${box.rect[3] * 100}%` }}
            >
              <span className="absolute left-0 top-0 max-w-full truncate bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">{name.replace(/_/g, " ")}</span>
            </button>;
          })}
          {drag ? <div className="absolute border-2 border-emerald-300 bg-emerald-500/10" style={{ left: `${drag[0] * 100}%`, top: `${drag[1] * 100}%`, width: `${drag[2] * 100}%`, height: `${drag[3] * 100}%` }} /> : null}
        </div>
        <div className="border-t border-white/10 p-3 text-xs text-slate-400">
          {imageUrl ? `${imageSize.width}x${imageSize.height} / ${source}` : "Frame required"} / accepted labels: {acceptedCount}
        </div>
      </section>

      <aside className="space-y-4">
      <section className="card flex max-h-[360px] flex-col overflow-hidden">
        <div className="border-b border-white/10 p-4">
          <h3 className="font-bold">Object Classes</h3>
          <p className="mt-1 text-xs text-slate-400">Active label set</p>
        </div>
        <div className="touch-scroll flex-1 space-y-4 overflow-auto p-3">
          {groupedClasses.map(([group, items]) => <div key={group}>
            <div className="mb-2 text-xs font-bold uppercase text-slate-400">{group}</div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((item) => <button key={item.id} type="button" onClick={() => setActiveClassId(item.id)} className={`min-h-10 rounded border px-2 py-2 text-left text-xs font-semibold ${activeClassId === item.id ? "border-cyan-300 bg-cyan-500/20 text-cyan-50" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>{item.name.replace(/_/g, " ")}</button>)}
            </div>
          </div>)}
        </div>
      </section>

        <section className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Boxes className="h-4 w-4 text-cyan-300" />Frame Labels</h3>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto">
            {boxes.length ? boxes.map((box) => {
              const boxClassName = classMap.get(box.classId)?.name ?? "";
              return <div key={box.id} className={`rounded-lg border p-2 ${box.suggested ? "border-amber-300/30 bg-amber-400/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex items-center gap-2">
                <select className="input min-h-9 min-w-0 flex-1 py-1 text-xs" value={box.classId} onChange={(event) => updateBoxClass(box.id, Number(event.target.value))}>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {box.suggested ? <button title="Accept suggestion" className="rounded p-2 text-emerald-200 hover:bg-white/10" onClick={() => acceptSuggestion(box.id)}><Check size={16} /></button> : null}
                <button title="Remove label" className="rounded p-2 text-rose-200 hover:bg-white/10" onClick={() => setBoxes((current) => current.filter((item) => item.id !== box.id))}><Trash2 size={16} /></button>
              </div>
              {isHeroMarkerClass(boxClassName) ? <label className="mt-2 block text-[11px] font-bold uppercase text-slate-400">
                Hero identity
                <select className="input mt-1 min-h-9 w-full py-1 text-xs font-medium normal-case" value={box.heroId ?? ""} onChange={(event) => updateBoxHero(box.id, Number(event.target.value))}>
                  <option value="">Unassigned</option>
                  {heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}
                </select>
              </label> : null}
              {isTranscriptClass(boxClassName) ? <label className="mt-2 block text-[11px] font-bold uppercase text-slate-400">
                Timer value
                <span className="mt-1 flex gap-2">
                  <input className="input min-h-9 min-w-0 flex-1 py-1 text-xs font-medium normal-case" value={box.transcript ?? ""} placeholder="45 or 01:20" inputMode="numeric" onChange={(event) => updateBoxTranscript(box.id, event.target.value)} />
                  <button type="button" className="min-h-9 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-100 disabled:opacity-50" disabled={!timerOcr?.packageAvailable || Boolean(busy)} onClick={() => void readTimerValue(box)}>Read</button>
                </span>
              </label> : null}
              {box.confidence != null ? <div className="mt-1 text-xs text-amber-100">Suggestion {Math.round(box.confidence * 100)}%</div> : null}
            </div>;
            }) : <p className="rounded-lg bg-white/5 p-3 text-sm text-slate-400">Draw a box to begin.</p>}
          </div>
          <div className="mt-4 flex gap-2">
            <select className="input flex-1" value={split} onChange={(event) => setSplit(event.target.value as "train" | "val")}>
              <option value="train">Training</option>
              <option value="val">Validation</option>
            </select>
            <button className="btn" onClick={saveCurrent} disabled={!frame || acceptedCount === 0 || Boolean(busy)}>Save</button>
          </div>
        </section>

        <section className="card p-4">
          <h3 className="flex items-center gap-2 font-bold"><Cpu className="h-4 w-4 text-cyan-300" />Training</h3>
          <p className="mt-2 text-xs text-slate-400">Ultralytics detection dataset</p>
          <button className="btn mt-3 flex w-full items-center justify-center gap-2" disabled={Boolean(busy)} onClick={train}><Play size={16} />{busy === "train" ? "Training..." : "Train Ultralytics"}</button>
          {!timerOcr?.packageAvailable || !timerOcr?.paddleAvailable || !screenOcr?.packageAvailable || !screenOcr?.paddleAvailable
            ? <button className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-white/5 text-sm font-semibold text-slate-100" disabled={Boolean(busy)} onClick={() => void installOcr()}>{busy === "install-ocr" ? "Installing OCR..." : "Install PaddleOCR"}</button>
            : null}
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Saved Frames</h3>
            <button title="Refresh" onClick={refresh} className="rounded p-2 text-slate-300 hover:bg-white/10"><RefreshCw size={16} /></button>
          </div>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto">
            {samples.length ? samples.map((sample) => <div key={sample.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => void openSample(sample)}>
                <div className="truncate text-xs font-semibold">{sample.source}</div>
                <div className="text-[11px] text-slate-400">{sample.split} / {sample.boxes.length} boxes</div>
              </button>
              <button title="Delete sample" className="rounded p-2 text-rose-200 hover:bg-white/10" onClick={() => void removeSample(sample.id)}><Trash2 size={15} /></button>
            </div>) : <p className="text-sm text-slate-400">No hand-labelled frames saved yet.</p>}
          </div>
        </section>
      </aside>
    </div>
  </div>;
}

function Status({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="card p-4"><div className="text-xs font-bold uppercase text-slate-400">{label}</div><div className="mt-2 text-lg font-black text-white">{value}</div><div className="mt-1 truncate text-xs text-slate-400">{detail}</div></div>;
}

function isHeroMarkerClass(name: string) {
  return name === "ally_hero_marker" || name === "enemy_hero_marker";
}

function isTranscriptClass(name: string) {
  return name.includes("respawn") || name.includes("counter") || name.includes("timer");
}

async function cropBlob(source: Blob, rect: Rect) {
  const bitmap = await createImageBitmap(source);
  const left = Math.max(0, Math.floor(rect[0] * bitmap.width));
  const top = Math.max(0, Math.floor(rect[1] * bitmap.height));
  const width = Math.max(1, Math.min(bitmap.width - left, Math.ceil(rect[2] * bitmap.width)));
  const height = Math.max(1, Math.min(bitmap.height - top, Math.ceil(rect[3] * bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create timer crop.")), "image/png"));
}
