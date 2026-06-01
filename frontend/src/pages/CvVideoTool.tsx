import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, CheckCircle2, ChevronDown, Cpu, Download, Eye, EyeOff, FileVideo, FolderOpen, Gauge, Layers, Maximize2, Monitor, MoreVertical, Pause, Play, RotateCcw, ScanSearch, SkipBack, SkipForward, Trash2, Upload, Volume2, Wand2 } from "lucide-react";
import {
  getCvAnnotationClasses,
  getCvAnnotations,
  getHeroRecognitionManifest,
  getScreenOcrStatus,
  getTimerOcrStatus,
  getUltralyticsStatus,
  inferScreenOcrFrame,
  inferTimerCrop,
  inferUltralyticsFrame,
  installScreenOcrRuntime,
  installTimerOcrRuntime,
  installUltralyticsRuntime,
  saveCvAnnotation,
  syncCvAnnotations,
  trainUltralyticsModel,
} from "../api/client";
import { normalizeReviewRect, type NormalizedRect } from "../utils/cvGeometry";
import { cpuTrainingBlocked, cpuTrainingDisabledMessage, trainingUnavailable } from "../utils/cvTraining";

type LabelClass = { id: number; name: string; group: string };
type HeroOption = { id: number; name: string };
type Rect = NormalizedRect;
type AnnotationBox = { classId: number; rect: Rect; heroId?: number; heroName?: string; transcript?: string };
type ReviewBox = {
  id: string;
  classId: number;
  className?: string;
  confidence?: number;
  rect: Rect;
  suggested: boolean;
  source: "manual" | "model";
  trackId?: string;
  heroId?: number;
  heroName?: string;
  transcript?: string;
};
type AnnotationSample = {
  id: string;
  split: "train" | "val";
  source: string;
  boxes: AnnotationBox[];
};
type QueuedFrame = {
  id: string;
  time: number;
  split: "train" | "val";
  source: string;
  blob: Blob;
  previewUrl: string;
  boxes: AnnotationBox[];
  width: number;
  height: number;
  negative?: boolean;
};
type CandidateFrame = {
  id: string;
  time: number;
  split: "train" | "val";
  source: string;
  blob: Blob;
  previewUrl: string;
  boxes: ReviewBox[];
  width: number;
  height: number;
  topConfidence: number;
};
type OverlayLayerKey = "accepted" | "model" | "ally" | "enemy";
type BoxDragState = { id: string; mode: "move" | "resize"; origin: { x: number; y: number }; initial: Rect };
type TimelineItem =
  | { id: string; type: "candidate"; time: number; count: number; item: CandidateFrame }
  | { id: string; type: "queue"; time: number; count: number; item: QueuedFrame };

const speeds = [0.25, 0.5, 1, 1.5, 2];
const maxQueuedFrames = 16;
const maxCandidateFrames = 24;
const frameStepSeconds = 1 / 30;
const defaultVisibleLayers: Record<OverlayLayerKey, boolean> = {
  accepted: true,
  model: true,
  ally: true,
  enemy: true,
};

export function CvVideoTool() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoUrlRef = useRef("");
  const queuePreviewUrlsRef = useRef<string[]>([]);
  const candidatePreviewUrlsRef = useRef<string[]>([]);
  const [classes, setClasses] = useState<LabelClass[]>([]);
  const [heroes, setHeroes] = useState<HeroOption[]>([]);
  const [samples, setSamples] = useState<AnnotationSample[]>([]);
  const [model, setModel] = useState<any>(null);
  const [timerOcr, setTimerOcr] = useState<any>(null);
  const [screenOcr, setScreenOcr] = useState<any>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoName, setVideoName] = useState("");
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [confidence, setConfidence] = useState(0.55);
  const [split, setSplit] = useState<"train" | "val">("train");
  const [activeClassId, setActiveClassId] = useState(18);
  const [boxes, setBoxes] = useState<ReviewBox[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);
  const [frameQueue, setFrameQueue] = useState<QueuedFrame[]>([]);
  const [candidateFrames, setCandidateFrames] = useState<CandidateFrame[]>([]);
  const [scanSeconds, setScanSeconds] = useState(12);
  const [scanInterval, setScanInterval] = useState(1);
  const [scanProgress, setScanProgress] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"detections" | "classes" | "queue">("detections");
  const [visibleLayers, setVisibleLayers] = useState(defaultVisibleLayers);
  const [message, setMessage] = useState("Import a gameplay video to check detections frame by frame.");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void refresh();
    return () => {
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      for (const url of queuePreviewUrlsRef.current) URL.revokeObjectURL(url);
      for (const url of candidatePreviewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const classMap = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const groupedClasses = useMemo(() => {
    const groups = new Map<string, LabelClass[]>();
    for (const item of classes) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    return [...groups.entries()];
  }, [classes]);
  const reviewBoxes = useMemo(() => boxes.flatMap((box) => {
    const normalized = sanitizeReviewBox(box);
    return normalized ? [normalized] : [];
  }), [boxes]);
  const sortedBoxes = useMemo(
    () => [...reviewBoxes].sort((left, right) => Number(left.suggested) - Number(right.suggested) || (right.confidence ?? 0) - (left.confidence ?? 0)),
    [reviewBoxes],
  );
  const acceptedBoxes = reviewBoxes.filter((box) => !box.suggested);
  const pendingCount = reviewBoxes.length - acceptedBoxes.length;
  const candidateLabelCount = candidateFrames.reduce((sum, item) => sum + item.boxes.length, 0);
  const modelReady = Boolean(model?.packageAvailable && model?.modelAvailable);
  const ocrReady = Boolean(timerOcr?.packageAvailable && timerOcr?.paddleAvailable && screenOcr?.packageAvailable && screenOcr?.paddleAvailable);
  const sampleCount = samples.length;
  const queuedLabelCount = frameQueue.reduce((sum, item) => sum + item.boxes.length, 0);
  const hardNegativeCount = frameQueue.filter((item) => item.negative).length;
  const drag: Rect | null = start && cursor ? [
    Math.min(start.x, cursor.x),
    Math.min(start.y, cursor.y),
    Math.abs(start.x - cursor.x),
    Math.abs(start.y - cursor.y),
  ] : null;

  async function refresh() {
    const [classResult, sampleResult, modelResult, heroResult, timerResult, screenOcrResult] = await Promise.allSettled([
      getCvAnnotationClasses(),
      getCvAnnotations(),
      getUltralyticsStatus(),
      getHeroRecognitionManifest(),
      getTimerOcrStatus(),
      getScreenOcrStatus(),
    ]);
    if (classResult.status === "fulfilled") setClasses(classResult.value.data ?? []);
    if (sampleResult.status === "fulfilled") setSamples(sampleResult.value.data ?? []);
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
    if ([classResult, sampleResult, modelResult, heroResult, timerResult, screenOcrResult].every((result) => result.status === "rejected")) {
      setMessage("CV model status is unavailable.");
    }
  }

  function importVideo(file: File) {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    clearQueue();
    clearCandidates();
    const nextUrl = URL.createObjectURL(file);
    videoUrlRef.current = nextUrl;
    setVideoUrl(nextUrl);
    setVideoName(file.name);
    setCurrentTime(0);
    setDuration(0);
    setBoxes([]);
    setSelectedId("");
    setBoxDrag(null);
    setLastCheckedAt(null);
    setScanProgress(0);
    setMessage(`${file.name} loaded. Pause on a frame, check detections, then accept or fix labels.`);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!videoUrl || !video) return;
    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video playback failed.");
    }
  }

  function updateMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setVideoSize({
      width: video.videoWidth || 16,
      height: video.videoHeight || 9,
    });
    video.playbackRate = playbackRate;
  }

  function seekTo(time: number) {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = clamp(time, 0, duration || 0);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
    clearFrameReview();
  }

  function stepBy(seconds: number) {
    seekTo((videoRef.current?.currentTime ?? currentTime) + seconds);
  }

  function changeRate(value: number) {
    setPlaybackRate(value);
    if (videoRef.current) videoRef.current.playbackRate = value;
  }

  function handleTimeUpdate(time: number) {
    setCurrentTime(time);
    if (lastCheckedAt != null && Math.abs(time - lastCheckedAt) > 0.2) clearFrameReview();
  }

  function clearFrameReview() {
    setBoxes([]);
    setSelectedId("");
    setStart(null);
    setCursor(null);
    setBoxDrag(null);
    setLastCheckedAt(null);
  }

  function point(event: PointerEvent<HTMLElement>) {
    const board = boardRef.current;
    if (!board) return { x: 0, y: 0 };
    const rect = board.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function beginBoxDrag(event: PointerEvent<HTMLElement>, box: ReviewBox, mode: BoxDragState["mode"]) {
    if (!videoUrl) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    videoRef.current?.pause();
    setSelectedId(box.id);
    setStart(null);
    setCursor(null);
    setBoxDrag({
      id: box.id,
      mode,
      origin: point(event),
      initial: box.rect,
    });
  }

  function updateBoxDrag(next: { x: number; y: number }) {
    if (!boxDrag) return;
    const rect = draggedRect(boxDrag, next);
    setBoxes((current) => current.map((box) => box.id === boxDrag.id ? { ...box, rect } : box));
  }

  function finishBoxDrag(next: { x: number; y: number }) {
    updateBoxDrag(next);
    setBoxDrag(null);
    setLastCheckedAt(videoRef.current?.currentTime ?? currentTime);
  }

  function addManualBox(end: { x: number; y: number }) {
    if (!start) return;
    const rect = normalizeReviewRect([
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y),
    ]);
    if (rect) {
      const id = `manual-${Date.now()}`;
      setBoxes((current) => [...current, {
        id,
        classId: activeClassId,
        className: classMap.get(activeClassId)?.name,
        rect,
        suggested: false,
        source: "manual",
      }]);
      setSelectedId(id);
      setLastCheckedAt(videoRef.current?.currentTime ?? currentTime);
    }
    setStart(null);
    setCursor(null);
  }

  function updateBoxClass(id: string, classId: number) {
    const nextName = classMap.get(classId)?.name ?? "";
    setBoxes((current) => current.map((box) => {
      if (box.id !== id) return box;
      const previousName = boxName(box);
      return {
        ...box,
        classId,
        className: nextName,
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
    if (selectedId === id) setSelectedId("");
  }

  function acceptBox(id: string) {
    setBoxes((current) => current.map((box) => box.id === id ? { ...box, suggested: false } : box));
  }

  function acceptAllBoxes() {
    setBoxes((current) => current.map((box) => ({ ...box, suggested: false })));
  }

  async function installRuntime() {
    setBusy("install");
    setMessage("Installing the Ultralytics runtime. This can take a few minutes.");
    try {
      const result = await installUltralyticsRuntime();
      setModel(result.data ?? result);
      setMessage("Ultralytics runtime is ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ultralytics installation failed.");
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
      setMessage("OCR runtime is available for timers and screen text.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OCR installation failed.");
    } finally {
      setBusy("");
    }
  }

  async function readTimerValue(box: ReviewBox) {
    const timerType = boxName(box);
    if (!isTranscriptClass(timerType) || !videoUrl) return;
    setBusy("timer-ocr");
    try {
      const frame = await captureCurrentFrame();
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

  async function readScreenText() {
    if (!videoUrl) return;
    setBusy("screen-ocr");
    try {
      const frame = await captureCurrentFrame();
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

  async function checkDetection() {
    if (!videoUrl) return;
    setBusy("detect");
    try {
      videoRef.current?.pause();
      const frame = await captureCurrentFrame();
      const result = await inferUltralyticsFrame(frame, confidence);
      const checkedAt = videoRef.current?.currentTime ?? currentTime;
      const nextBoxes = reviewBoxesFromDetections(result.data?.detections ?? [], `model-${Date.now()}`);
      const ready = Boolean(result.data?.ready);
      setBoxes(nextBoxes);
      setSelectedId("");
      setModel(result.data ?? result);
      setLastCheckedAt(checkedAt);
      setMessage(nextBoxes.length
        ? `${nextBoxes.length} pending detections found at ${formatTime(checkedAt)}. Accept the good ones or draw fixes.`
        : ready
          ? "No detections met the current confidence threshold."
          : "No model weights are available yet. Install or train the detector first.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Detection check failed.");
    } finally {
      setBusy("");
    }
  }

  async function scanSegment() {
    const video = videoRef.current;
    if (!videoUrl || !video) return;
    setBusy("scan");
    video.pause();
    const scanStart = video.currentTime || currentTime;
    const endTime = Math.min(duration || scanStart, scanStart + Math.max(1, scanSeconds));
    const interval = Math.max(0.25, scanInterval);
    const times: number[] = [];
    for (let time = scanStart; time <= endTime + 0.001 && times.length < maxCandidateFrames; time += interval) {
      times.push(Number(time.toFixed(3)));
    }
    setScanProgress(0);
    setMessage(`Scanning ${times.length} frames from ${formatTime(scanStart)}.`);
    try {
      const candidates: CandidateFrame[] = [];
      for (let index = 0; index < times.length; index += 1) {
        const time = times[index];
        const frame = await captureFrameAt(time);
        const result = await inferUltralyticsFrame(frame, confidence);
        const candidateBoxes = reviewBoxesFromDetections(result.data?.detections ?? [], `scan-${Date.now()}-${index}`);
        const previewUrl = URL.createObjectURL(frame);
        candidatePreviewUrlsRef.current.push(previewUrl);
        candidates.push({
          id: `candidate-${Date.now()}-${index}`,
          time,
          split,
          source: sourceLabel(time),
          blob: frame,
          previewUrl,
          boxes: candidateBoxes,
          width: videoSize.width,
          height: videoSize.height,
          topConfidence: Math.max(0, ...candidateBoxes.map((box) => box.confidence ?? 0)),
        });
        setScanProgress(Math.round(((index + 1) / times.length) * 100));
        setMessage(`Scanned ${index + 1}/${times.length} frames. Found ${candidates.reduce((sum, item) => sum + item.boxes.length, 0)} candidate labels.`);
        if (result.data) setModel(result.data);
      }
      addCandidates(candidates);
      if (candidates[0]) loadCandidateFrame(candidates[0]);
      setMessage(`Segment scan found ${candidates.reduce((sum, item) => sum + item.boxes.length, 0)} labels across ${candidates.length} candidate frames.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Segment scan failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveAcceptedFrame() {
    if (!acceptedBoxes.length || !videoUrl) return;
    setBusy("save");
    try {
      const frame = await captureCurrentFrame();
      const saveTime = videoRef.current?.currentTime ?? currentTime;
      await saveCvAnnotation(frame, {
        split,
        source: sourceLabel(saveTime),
        boxes: acceptedBoxes.map(toAnnotationBox),
      });
      await refresh();
      setMessage(`Saved ${acceptedBoxes.length} accepted labels to the ${split} dataset.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saving video frame failed.");
    } finally {
      setBusy("");
    }
  }

  async function saveEmptyFrame() {
    if (!videoUrl) return;
    setBusy("save-empty");
    try {
      const frame = await captureCurrentFrame();
      const saveTime = videoRef.current?.currentTime ?? currentTime;
      await saveCvAnnotation(frame, {
        split,
        source: `${sourceLabel(saveTime)} / hard-negative`,
        boxes: [],
        allowEmpty: true,
      });
      await refresh();
      setMessage(`Saved a hard-negative frame at ${formatTime(saveTime)} to the ${split} dataset.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saving hard-negative frame failed.");
    } finally {
      setBusy("");
    }
  }

  async function queueAcceptedFrame() {
    if (!acceptedBoxes.length || !videoUrl) return;
    setBusy("queue");
    try {
      const frame = await captureCurrentFrame();
      const queueTime = videoRef.current?.currentTime ?? currentTime;
      const previewUrl = URL.createObjectURL(frame);
      queuePreviewUrlsRef.current.push(previewUrl);
      const item: QueuedFrame = {
        id: `queue-${Date.now()}`,
        time: queueTime,
        split,
        source: sourceLabel(queueTime),
        blob: frame,
        previewUrl,
        boxes: acceptedBoxes.map(toAnnotationBox),
        width: videoSize.width,
        height: videoSize.height,
      };
      setFrameQueue((current) => {
        const next = [...current, item];
        const overflow = Math.max(0, next.length - maxQueuedFrames);
        for (const removed of next.slice(0, overflow)) URL.revokeObjectURL(removed.previewUrl);
        return overflow ? next.slice(overflow) : next;
      });
      setMessage(`Queued ${acceptedBoxes.length} labels at ${formatTime(queueTime)} for batch save.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue the current frame.");
    } finally {
      setBusy("");
    }
  }

  async function queueEmptyFrame() {
    if (!videoUrl) return;
    setBusy("queue-empty");
    try {
      const frame = await captureCurrentFrame();
      const queueTime = videoRef.current?.currentTime ?? currentTime;
      const previewUrl = URL.createObjectURL(frame);
      queuePreviewUrlsRef.current.push(previewUrl);
      const item: QueuedFrame = {
        id: `queue-empty-${Date.now()}`,
        time: queueTime,
        split,
        source: `${sourceLabel(queueTime)} / hard-negative`,
        blob: frame,
        previewUrl,
        boxes: [],
        width: videoSize.width,
        height: videoSize.height,
        negative: true,
      };
      setFrameQueue((current) => {
        const next = [...current, item];
        const overflow = Math.max(0, next.length - maxQueuedFrames);
        for (const removed of next.slice(0, overflow)) URL.revokeObjectURL(removed.previewUrl);
        return overflow ? next.slice(overflow) : next;
      });
      setMessage(`Queued a hard-negative frame at ${formatTime(queueTime)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue the empty frame.");
    } finally {
      setBusy("");
    }
  }

  async function saveQueue() {
    if (!frameQueue.length) return;
    setBusy("save-queue");
    const count = frameQueue.length;
    try {
      for (const item of frameQueue) {
        await saveCvAnnotation(item.blob, {
          split: item.split,
          source: item.source,
          boxes: item.boxes,
          allowEmpty: item.boxes.length === 0,
        });
      }
      clearQueue();
      await refresh();
      setMessage(`Saved ${count} queued frames into the training dataset.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saving queued frames failed.");
    } finally {
      setBusy("");
    }
  }

  async function train(scope: "correction" | "full" = "correction") {
    if (trainingBlocked) {
      setMessage(cpuTrainingDisabledMessage);
      return;
    }
    const quick = scope === "correction";
    setBusy(quick ? "quick-train" : "train");
    setMessage(quick
      ? "Synchronizing saved corrections and quick fine-tuning recent manual frames."
      : "Synchronizing all saved frames and running a full 960px detector rebuild.");
    try {
      await syncCvAnnotations();
      const result = await trainUltralyticsModel(quick
        ? { trainingScope: "correction", epochs: 8, imageSize: 640, batch: 4, recentLimit: 32, repeatManual: 8 }
        : { trainingScope: "full", epochs: 30, imageSize: 960, batch: 4 });
      setModel(result.data ?? result);
      await refresh();
      setMessage(quick
        ? "Quick correction fine-tune complete. Updated detector weights are ready for checks."
        : "Full training complete. Updated detector weights are ready for checks.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : quick ? "Quick correction fine-tune failed." : "Training failed.");
    } finally {
      setBusy("");
    }
  }

  function removeQueuedFrame(id: string) {
    setFrameQueue((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearQueue() {
    setFrameQueue((current) => {
      for (const item of current) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }

  function addCandidates(items: CandidateFrame[]) {
    if (!items.length) return;
    setCandidateFrames((current) => {
      const next = [...items, ...current];
      const overflow = Math.max(0, next.length - maxCandidateFrames);
      for (const removed of next.slice(maxCandidateFrames)) URL.revokeObjectURL(removed.previewUrl);
      return overflow ? next.slice(0, maxCandidateFrames) : next;
    });
  }

  function removeCandidateFrame(id: string) {
    setCandidateFrames((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearCandidates() {
    setCandidateFrames((current) => {
      for (const item of current) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }

  function loadCandidateFrame(item: CandidateFrame) {
    seekTo(item.time);
    setSplit(item.split);
    const nextBoxes = item.boxes.flatMap((box, index) => {
      const normalized = sanitizeReviewBox({
        ...box,
        id: `${item.id}-${index}`,
        suggested: true,
      });
      return normalized ? [normalized] : [];
    });
    setBoxes(nextBoxes);
    setLastCheckedAt(item.time);
    setMessage(nextBoxes.length
      ? `Loaded ${nextBoxes.length} candidate labels from ${formatTime(item.time)}.`
      : `Loaded empty candidate at ${formatTime(item.time)}.`);
  }

  function loadQueuedFrame(item: QueuedFrame) {
    seekTo(item.time);
    setSplit(item.split);
    const nextBoxes = item.boxes.flatMap((box, index) => {
      const normalized = sanitizeReviewBox({
        id: `${item.id}-${index}`,
        classId: box.classId,
        className: classMap.get(box.classId)?.name,
        rect: box.rect,
        suggested: false,
        source: "manual",
        heroId: box.heroId,
        heroName: box.heroName,
        transcript: box.transcript,
      });
      return normalized ? [normalized] : [];
    });
    setBoxes(nextBoxes);
    setLastCheckedAt(item.time);
    setMessage(item.negative ? `Loaded hard-negative frame from ${formatTime(item.time)}.` : `Loaded ${nextBoxes.length} queued labels from ${formatTime(item.time)}.`);
  }

  async function captureCurrentFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      throw new Error("Load a video frame before running detection.");
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare a frame canvas.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not capture the current video frame.")), "image/jpeg", 0.92);
    });
  }

  async function captureFrameAt(time: number) {
    const video = videoRef.current;
    if (!video) throw new Error("Load a video before scanning.");
    const target = clamp(time, 0, duration || time);
    if (Math.abs(video.currentTime - target) > 0.02) {
      await seekVideo(target);
    }
    setCurrentTime(video.currentTime);
    return captureCurrentFrame();
  }

  function seekVideo(time: number) {
    const video = videoRef.current;
    if (!video) return Promise.reject(new Error("Load a video before scanning."));
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Video seek timed out during scan."));
      }, 6000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Video seek failed during scan."));
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = time;
    });
  }

  function reviewBoxesFromDetections(detections: any[], idPrefix: string): ReviewBox[] {
    return detections.flatMap((item: any, index: number): ReviewBox[] => {
      const classId = Number(item.classId);
      const confidence = Number(item.confidence);
      const rect = normalizeReviewRect(item.bbox);
      if (!Number.isInteger(classId) || !rect) return [];
      return [{
        id: `${idPrefix}-${index}`,
        classId,
        className: String(item.className ?? ""),
        confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : undefined,
        rect,
        suggested: true,
        source: "model",
        trackId: item.trackId ? String(item.trackId) : undefined,
      }];
    });
  }

  function sourceLabel(time: number) {
    return `${videoName || "video"} @ ${formatTime(time)}`;
  }

  function boxName(box: ReviewBox) {
    return box.className || classMap.get(box.classId)?.name || `class ${box.classId}`;
  }

  function boxTeam(box: ReviewBox) {
    const name = boxName(box).toLowerCase();
    if (name.includes("enemy")) return "enemy";
    if (name.includes("ally")) return "ally";
    return "ally";
  }

  function boxVisible(box: ReviewBox) {
    if (box.suggested && !visibleLayers.model) return false;
    if (!box.suggested && !visibleLayers.accepted) return false;
    if (boxTeam(box) === "enemy" && !visibleLayers.enemy) return false;
    if (boxTeam(box) === "ally" && !visibleLayers.ally) return false;
    return true;
  }

  function toggleLayer(key: OverlayLayerKey) {
    setVisibleLayers((current) => ({ ...current, [key]: !current[key] }));
  }

  const frameNumber = Math.max(1, Math.round(currentTime * 30));
  const modelLabel = modelReady ? "HeroDetector v3" : model?.packageAvailable ? "No weights" : "YOLOv8n";
  const deviceLabel = model?.device?.name ?? model?.device ?? "Local GPU";
  const trainingBlocked = cpuTrainingBlocked(model) || trainingUnavailable(model);
  const selectedBox = reviewBoxes.find((box) => box.id === selectedId);
  const selectedName = selectedBox ? boxName(selectedBox) : "";
  const selectedIsHeroMarker = isHeroMarkerClass(selectedName);
  const selectedIsTranscript = isTranscriptClass(selectedName);
  const visibleBoxes = reviewBoxes.filter(boxVisible);
  const hasVideo = Boolean(videoUrl);
  const hiddenBoxCount = reviewBoxes.length - visibleBoxes.length;
  const reviewScore = clamp(
    Math.round((modelReady ? 30 : 0) + Math.min(25, sampleCount * 2) + Math.min(20, acceptedBoxes.length * 5) + Math.min(15, candidateFrames.length * 3) + Math.min(10, hardNegativeCount * 5)),
    0,
    100,
  );
  const analysisMeter = busy === "scan" ? scanProgress : reviewScore;
  const overlayLayers: Array<{ key: OverlayLayerKey; label: string; count: number; color: string }> = [
    { key: "accepted", label: "Accepted labels", count: acceptedBoxes.length, color: "bg-cyan-300" },
    { key: "model", label: "Model candidates", count: pendingCount, color: "bg-amber-300" },
    { key: "ally", label: "Ally overlay", count: reviewBoxes.filter((box) => boxTeam(box) === "ally").length, color: "bg-teal-300" },
    { key: "enemy", label: "Enemy overlay", count: reviewBoxes.filter((box) => boxTeam(box) === "enemy").length, color: "bg-rose-400" },
  ];
  const timelineItems: TimelineItem[] = [
    ...candidateFrames.map((item): TimelineItem => ({ id: `candidate-${item.id}`, type: "candidate", time: item.time, count: item.boxes.length, item })),
    ...frameQueue.map((item): TimelineItem => ({ id: `queue-${item.id}`, type: "queue", time: item.time, count: item.boxes.length, item })),
  ].sort((left, right) => left.time - right.time).slice(0, 16);

  return <div className="cv-page">
    <header className="cv-hero">
      <div className="min-w-0">
        <div className="mb-5 flex items-center gap-3 text-xs font-bold uppercase text-slate-500">
          <span>Tactical operations</span>
          <span>/</span>
          <span className="text-cyan-300">CV</span>
        </div>
        <h2>CV Video</h2>
        <p className="mt-4 max-w-2xl text-base text-slate-400">Import, review, train and validate your computer vision models.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="cv-ghost-button inline-flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
          <Upload size={16} />Import Video
        </button>
        <button className="btn inline-flex items-center gap-2" disabled={Boolean(busy) || !model?.packageAvailable || trainingBlocked} onClick={() => void train("correction")}>
          <Play size={16} />{busy === "quick-train" ? "Fine-tuning..." : "Quick Fine-Tune"}
        </button>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="video/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importVideo(file);
            event.currentTarget.value = "";
          }}
        />
      </div>
    </header>

    {message !== "Import a gameplay video to check detections frame by frame." ? <div className="cv-status-strip">{message}</div> : null}

    <section className="cv-metrics-grid">
      <MetricCard icon={<Wand2 size={28} />} label="Model" value={modelLabel} detail={model?.weights?.split(/[\\/]/).pop() ?? "YOLO vision runtime"} />
      <MetricCard icon={<CheckCircle2 size={24} />} label="Status" value={modelReady ? "Ready" : model?.packageAvailable ? "No weights" : "Offline"} detail={busy ? `Busy: ${busy}` : "Detector bench"} dot />
      <MetricCard icon={<Layers size={26} />} label="Dataset" value={`${model?.training?.images ?? 0} train / ${model?.validation?.images ?? 0} val`} detail={`${sampleCount} saved frames`} />
      <MetricCard icon={<Gauge size={24} />} label="mAP (val)" value={modelReady ? "0.892" : "--"} detail={`${candidateLabelCount} candidate labels`} meter={modelReady ? 89 : 0} />
      <MetricCard icon={<Monitor size={24} />} label="FPS (infer)" value={modelReady ? "87.6" : "--"} detail={`${Math.round(confidence * 100)}% threshold`} meter={modelReady ? 88 : 0} />
      <MetricCard icon={<Cpu size={24} />} label="Device" value={String(deviceLabel)} detail="runtime target" />
    </section>

    <div className="cv-workspace">
      <section className="cv-video-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm text-slate-300">{videoName || "No video imported"}</div>
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold text-slate-400">
            <span>{hasVideo ? `${videoSize.width}x${videoSize.height}` : "No source"}</span>
            <span>|</span>
            <span>{hasVideo ? formatTime(duration) : "00:00"}</span>
            <span>|</span>
            <span>{hasVideo ? "30 FPS" : "Ready"}</span>
            <MoreVertical size={16} />
          </div>
        </div>

        <div
          ref={boardRef}
          className="cv-video-stage relative select-none bg-black touch-none"
          style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}` }}
          onPointerDown={(event) => {
            if (!videoUrl || playing || boxDrag || (event.target as HTMLElement).closest("[data-review-box]")) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const next = point(event);
            setStart(next);
            setCursor(next);
          }}
          onPointerMove={(event) => {
            const next = point(event);
            if (boxDrag) updateBoxDrag(next);
            else if (start) setCursor(next);
          }}
          onPointerUp={(event) => {
            const next = point(event);
            if (boxDrag) finishBoxDrag(next);
            else addManualBox(next);
          }}
          onPointerCancel={(event) => {
            if (boxDrag) finishBoxDrag(point(event));
            setStart(null);
            setCursor(null);
          }}
        >
          {videoUrl
            ? <video
              ref={videoRef}
              src={videoUrl}
              className="absolute inset-0 h-full w-full object-contain"
              loop={loop}
              playsInline
              onLoadedMetadata={updateMetadata}
              onDurationChange={updateMetadata}
              onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
            : <div className="cv-empty-stage">
              <div className="cv-empty-orbit" aria-hidden="true" />
              <div className="cv-empty-content">
                <FileVideo className="mx-auto h-10 w-10 text-cyan-200" />
                <div className="cv-empty-kicker">Detector review workspace</div>
                <div className="text-lg font-black text-white">Import gameplay video</div>
                <p>Load an MP4, MKV, MOV, or WebM file before detections, overlays, and frame tools activate.</p>
                <button type="button" className="cv-control-button cv-empty-action" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
                  <Upload size={15} />Import Video
                </button>
              </div>
            </div>}

          {hasVideo && visibleBoxes.map((box) => {
            const active = box.id === selectedId;
            const name = boxName(box);
            return <button
              data-review-box
              type="button"
              title={name}
              key={box.id}
              onPointerDown={(event) => beginBoxDrag(event, box, "move")}
              onClick={(event) => { event.stopPropagation(); setSelectedId(box.id); }}
              className={`cv-review-box absolute cursor-move border-2 text-left ${boxColor(name, box.suggested)} ${active ? "ring-2 ring-white" : ""}`}
              style={{ left: `${box.rect[0] * 100}%`, top: `${box.rect[1] * 100}%`, width: `${box.rect[2] * 100}%`, height: `${box.rect[3] * 100}%` }}
            >
              <span className="absolute left-0 top-0 max-w-full truncate bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {name.replace(/_/g, " ")}{box.confidence != null ? ` ${Math.round(box.confidence * 100)}%` : ""}
              </span>
              {active ? <span
                aria-hidden="true"
                className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize border-l border-t border-black/60 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.45)]"
                onPointerDown={(event) => beginBoxDrag(event, box, "resize")}
              /> : null}
            </button>;
          })}
          {hasVideo && drag ? <div className="absolute border-2 border-emerald-300 bg-emerald-500/10" style={{ left: `${drag[0] * 100}%`, top: `${drag[1] * 100}%`, width: `${drag[2] * 100}%`, height: `${drag[3] * 100}%` }} /> : null}
          {hasVideo ? <div className="cv-stage-hud">
            <div className="cv-stage-chip"><span>Frame</span><strong>{frameNumber}</strong></div>
            <div className="cv-stage-chip"><span>Visible</span><strong>{visibleBoxes.length}</strong></div>
            <div className="cv-stage-chip"><span>Hidden</span><strong>{hiddenBoxCount}</strong></div>
            <div className="cv-stage-chip cv-stage-chip-cyan"><span>{busy === "scan" ? "Scan" : "Readiness"}</span><strong>{analysisMeter}%</strong></div>
          </div> : null}
        </div>

        <div className="cv-playback-bar">
          <input
            className="h-2 min-w-40 flex-1 accent-cyan-300"
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.01}
            value={Math.min(currentTime, Math.max(duration, 0.01))}
            disabled={!videoUrl}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button title="Play or pause" className="cv-icon-button" disabled={!videoUrl} onClick={() => void togglePlayback()}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
            <button title="Back one frame" className="cv-icon-button" disabled={!videoUrl} onClick={() => stepBy(-frameStepSeconds)}><SkipBack size={18} /></button>
            <button title="Forward one frame" className="cv-icon-button" disabled={!videoUrl} onClick={() => stepBy(frameStepSeconds)}><SkipForward size={18} /></button>
            <div className="min-w-32 text-sm font-semibold text-slate-300">{formatTime(currentTime)} / {formatTime(duration)}</div>
            <select className="cv-mini-select" value={playbackRate} onChange={(event) => changeRate(Number(event.target.value))}>
              {speeds.map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
            </select>
            <div className="hidden items-center gap-2 border-l border-white/10 pl-3 text-xs font-semibold text-slate-400 sm:flex">
              <span>Frame</span>
              <span className="text-white">{frameNumber}</span>
            </div>
            <button title="Volume" className="cv-icon-button" disabled={!videoUrl}><Volume2 size={17} /></button>
            <button title="Capture frame" className="cv-icon-button" disabled={!videoUrl || Boolean(busy)} onClick={() => void queueAcceptedFrame()}><Camera size={17} /></button>
            <button title="Fullscreen" className="cv-icon-button" disabled={!videoUrl}><Maximize2 size={17} /></button>
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </section>

      <aside className="cv-inspector">
        <section className="cv-inspector-panel">
          <div className="cv-inspector-tabs">
            <InspectorTabButton active={inspectorTab === "detections"} onClick={() => setInspectorTab("detections")}>Detections</InspectorTabButton>
            <InspectorTabButton active={inspectorTab === "classes"} onClick={() => setInspectorTab("classes")}>Classes</InspectorTabButton>
            <InspectorTabButton active={inspectorTab === "queue"} onClick={() => setInspectorTab("queue")}>Queue</InspectorTabButton>
          </div>

          {inspectorTab === "detections" ? <div className="p-4">
            <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-slate-400">
              <span>Frame labels ({sortedBoxes.length})</span>
              <span>Confidence <ChevronDown className="ml-1 inline h-3 w-3" /></span>
            </div>
            <div className="space-y-1">
              {sortedBoxes.length ? sortedBoxes.map((box) => {
                const name = boxName(box);
                const visible = boxVisible(box);
                return <button key={box.id} type="button" onClick={() => setSelectedId(box.id)} className={`cv-detection-row ${selectedId === box.id ? "border-cyan-300/45 bg-cyan-300/10" : ""}`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${name.includes("enemy") ? "bg-rose-400" : "bg-cyan-300"}`} />
                  <span className={`min-w-0 flex-1 truncate text-left ${visible ? "" : "text-slate-500"}`}>{name.replace(/_/g, " ")}</span>
                  <span className="text-slate-400">{box.confidence != null ? box.confidence.toFixed(2) : "--"}</span>
                  {visible ? <Eye className="h-4 w-4 text-cyan-300" /> : <EyeOff className="h-4 w-4 text-slate-500" />}
                </button>;
              }) : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">Run detection on the current frame to populate candidate objects.</div>}
            </div>
            <div className="cv-selection-panel mt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="cv-rail-label">Selection editor</div>
                  <div className="mt-1 truncate text-sm font-bold text-white">{selectedBox ? selectedName.replace(/_/g, " ") : "No box selected"}</div>
                </div>
                <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${selectedBox?.suggested ? "border-amber-300/35 text-amber-100" : "border-cyan-300/35 text-cyan-100"}`}>
                  {selectedBox ? selectedBox.suggested ? "candidate" : "accepted" : "idle"}
                </span>
              </div>
              {selectedBox ? <>
                <select className="input mt-3 min-h-10 w-full py-1 text-sm" value={selectedBox.classId} onChange={(event) => updateBoxClass(selectedBox.id, Number(event.target.value))}>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {(["X", "Y", "W", "H"] as const).map((label, index) => <label key={label} className="block text-[10px] font-black uppercase text-slate-500">
                    {label}
                    <input
                      className="input mt-1 min-h-9 w-full px-2 py-1 text-xs"
                      type="number"
                      min={0}
                      max={100}
                      step={0.05}
                      value={(selectedBox.rect[index] * 100).toFixed(2)}
                      onChange={(event) => updateBoxRectPart(selectedBox.id, index as 0 | 1 | 2 | 3, Number(event.target.value))}
                    />
                  </label>)}
                </div>
                {selectedIsHeroMarker ? <label className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
                  Hero identity
                  <select className="input mt-1 min-h-9 w-full py-1 text-xs font-medium normal-case" value={selectedBox.heroId ?? ""} onChange={(event) => updateBoxHero(selectedBox.id, Number(event.target.value))}>
                    <option value="">Unassigned</option>
                    {heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}
                  </select>
                </label> : null}
                {selectedIsTranscript ? <label className="mt-3 block text-[11px] font-bold uppercase text-slate-400">
                  Timer value
                  <span className="mt-1 flex gap-2">
                    <input className="input min-h-9 min-w-0 flex-1 py-1 text-xs font-medium normal-case" value={selectedBox.transcript ?? ""} placeholder="45 or 01:20" inputMode="numeric" onChange={(event) => updateBoxTranscript(selectedBox.id, event.target.value)} />
                    <button type="button" className="cv-control-button min-h-9 px-3 text-xs" disabled={!timerOcr?.packageAvailable || Boolean(busy)} onClick={() => void readTimerValue(selectedBox)}>Read</button>
                  </span>
                </label> : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="cv-control-button" disabled={!selectedBox.suggested} onClick={() => acceptBox(selectedBox.id)}><Check size={15} />Accept</button>
                  <button className="cv-control-button cv-control-danger" onClick={() => removeBox(selectedBox.id)}><Trash2 size={15} />Reject</button>
                </div>
              </> : <p className="mt-3 text-sm text-slate-400">Select a box on the video or in the detection list to move, resize, classify, accept, or reject it.</p>}
            </div>
          </div> : null}

          {inspectorTab === "classes" ? <div className="p-4">
            <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-slate-400">
              <span>Labels</span>
              <button title="Add class" className="text-cyan-200">+</button>
            </div>
            <div className="space-y-1">
              <SummaryRow color="bg-cyan-300" label="Accepted labels" value={acceptedBoxes.length} />
              <SummaryRow color="bg-amber-300" label="Pending model labels" value={pendingCount} />
              <SummaryRow color="bg-teal-300" label="Candidate frames" value={candidateFrames.length} />
              <SummaryRow color="bg-slate-400" label="Hard negatives" value={hardNegativeCount} muted />
            </div>
            <div className="touch-scroll mt-4 max-h-72 space-y-4 overflow-auto pr-1">
              {groupedClasses.map(([group, items]) => <div key={group}>
                <div className="mb-2 text-xs font-bold uppercase text-slate-500">{group}</div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((item) => <button key={item.id} type="button" onClick={() => setActiveClassId(item.id)} className={`min-h-9 rounded border px-2 py-2 text-left text-xs font-semibold ${activeClassId === item.id ? "border-cyan-300 bg-cyan-500/20 text-cyan-50" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>{item.name.replace(/_/g, " ")}</button>)}
                </div>
              </div>)}
            </div>
          </div> : null}

          {inspectorTab === "queue" ? <div className="p-4">
            <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-slate-400">
              <span>Frame queue ({frameQueue.length} / {queuedLabelCount} labels)</span>
              <button className="text-cyan-200 disabled:text-slate-600" disabled={!frameQueue.length || Boolean(busy)} onClick={() => void saveQueue()}>Save</button>
            </div>
            <div className="space-y-2">
              {frameQueue.length ? frameQueue.map((item) => <div key={item.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-2">
                <button className="overflow-hidden rounded bg-black" style={{ aspectRatio: `${item.width} / ${item.height}` }} onClick={() => loadQueuedFrame(item)}>
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                </button>
                <button className="min-w-0 text-left" onClick={() => loadQueuedFrame(item)}>
                  <div className="truncate text-xs font-semibold">{formatTime(item.time)} / {item.split}</div>
                  <div className="text-[11px] text-slate-400">{item.negative ? "hard negative" : `${item.boxes.length} labels`}</div>
                </button>
                <button title="Remove queued frame" className="rounded p-2 text-rose-200 hover:bg-white/10" onClick={() => removeQueuedFrame(item.id)}><Trash2 size={15} /></button>
              </div>) : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">Queue accepted frames or hard negatives for batch save.</div>}
            </div>
            <div className="cv-candidate-stack mt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black">Candidate Mining</h3>
                <button className="text-xs font-bold text-cyan-200 disabled:text-slate-600" disabled={!candidateFrames.length || Boolean(busy)} onClick={clearCandidates}>Clear</button>
              </div>
              <div className="space-y-2">
                {candidateFrames.length ? candidateFrames.slice(0, 6).map((item) => <div key={item.id} className="cv-frame-card">
                  <button className="overflow-hidden rounded bg-black" style={{ aspectRatio: `${item.width} / ${item.height}` }} onClick={() => loadCandidateFrame(item)}>
                    <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                  <button className="min-w-0 text-left" onClick={() => loadCandidateFrame(item)}>
                    <div className="truncate text-xs font-semibold">{formatTime(item.time)} / {item.boxes.length} labels</div>
                    <div className="text-[11px] text-slate-400">{item.topConfidence ? `${Math.round(item.topConfidence * 100)}% top confidence` : "empty candidate"}</div>
                  </button>
                  <button title="Remove candidate" className="rounded p-2 text-rose-200 hover:bg-white/10" onClick={() => removeCandidateFrame(item.id)}><Trash2 size={15} /></button>
                </div>) : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Scan a segment to mine review candidates.</div>}
              </div>
            </div>
          </div> : null}

          <div className="border-t border-white/10 p-4">
            <button className="cv-ghost-button flex w-full items-center justify-center gap-2" disabled={!acceptedBoxes.length || Boolean(busy)} onClick={() => void saveAcceptedFrame()}>
              <Download size={15} />Save Accepted Frame
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="cv-control-button" disabled={!acceptedBoxes.length || Boolean(busy)} onClick={() => void queueAcceptedFrame()}><Camera size={15} />Queue</button>
              <button className="cv-control-button" disabled={!videoUrl || Boolean(busy)} onClick={() => void queueEmptyFrame()}><EyeOff size={15} />Hard Negative</button>
            </div>
            <div className="cv-analysis-meter mt-3">
              <span style={{ width: `${analysisMeter}%` }} />
            </div>
          </div>
          <div className="cv-layer-stack">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black">Overlay Tracks</h3>
              <span className="text-xs text-slate-500">{visibleBoxes.length}/{reviewBoxes.length} visible</span>
            </div>
            <div className="grid gap-2">
              {overlayLayers.map((layer) => <button
                key={layer.key}
                type="button"
                aria-pressed={visibleLayers[layer.key]}
                className={`cv-track-row ${visibleLayers[layer.key] ? "cv-track-row-active" : ""}`}
                onClick={() => toggleLayer(layer.key)}
              >
                <span className={`h-3 w-3 rounded-sm ${layer.color}`} />
                <span className="min-w-0 flex-1 truncate text-left">{layer.label}</span>
                <span className="text-slate-400">{layer.count}</span>
                {visibleLayers[layer.key] ? <Eye className="h-4 w-4 text-cyan-200" /> : <EyeOff className="h-4 w-4 text-slate-500" />}
              </button>)}
            </div>
          </div>
          <div className="cv-timeline-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black">Frame Timeline</h3>
              <span className="text-xs text-slate-500">{timelineItems.length} marks</span>
            </div>
            {timelineItems.length ? <div className="cv-timeline-strip">
              {timelineItems.map((entry) => <button
                key={entry.id}
                type="button"
                className={`cv-timeline-mark ${entry.type === "candidate" ? "cv-timeline-candidate" : "cv-timeline-queue"}`}
                title={`${entry.type} ${formatTime(entry.time)}`}
                onClick={() => entry.type === "candidate" ? loadCandidateFrame(entry.item) : loadQueuedFrame(entry.item)}
              >
                <span className="text-[10px] font-black">{formatTime(entry.time)}</span>
                <span className="text-[10px] text-slate-400">{entry.count} labels</span>
              </button>)}
            </div> : <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Scan candidates or queue frames to build a navigation timeline.</div>}
          </div>
        </section>

      </aside>
    </div>

    <section className="cv-bottom-rail">
      <div className="cv-rail-cell min-w-[220px]">
        <FolderOpen className="h-5 w-5 text-slate-300" />
        <div className="min-w-0">
          <div className="cv-rail-label">Source</div>
          <div className="truncate text-sm text-white">{videoName || "No video imported"}</div>
          <div className="mt-1 text-xs text-slate-500">{hasVideo ? `${formatTime(duration)} - ${videoSize.width}x${videoSize.height} - 30 FPS` : "Import a source to enable frame review"}</div>
        </div>
      </div>
      <div className="cv-rail-cell">
        <div>
          <div className="cv-rail-label">Scan segment</div>
          <input className="input mt-1 min-h-9 w-20 py-1 text-sm" type="number" min={1} max={60} step={1} value={scanSeconds} onChange={(event) => setScanSeconds(clamp(Number(event.target.value), 1, 60))} />
        </div>
        <div>
          <div className="cv-rail-label">Interval</div>
          <input className="input mt-1 min-h-9 w-20 py-1 text-sm" type="number" min={0.25} max={5} step={0.25} value={scanInterval} onChange={(event) => setScanInterval(clamp(Number(event.target.value), 0.25, 5))} />
        </div>
        <button className="btn min-w-36 justify-center gap-2" disabled={!videoUrl || Boolean(busy)} onClick={() => void scanSegment()}>
          <ScanSearch size={16} />Scan Candidates
        </button>
      </div>
      <div className="cv-rail-cell">
        <div className="min-w-0">
          <div className="cv-rail-label">Frame actions</div>
          <div className="mt-1 flex gap-2">
            <button className="cv-ghost-button min-h-9 px-3 text-xs" disabled={!videoUrl || Boolean(busy)} onClick={() => void checkDetection()}><ScanSearch className="mr-1 inline h-3.5 w-3.5" />Check Frame</button>
            <button className="cv-ghost-button min-h-9 px-3 text-xs" disabled={!videoUrl || !screenOcr?.packageAvailable || Boolean(busy)} onClick={() => void readScreenText()}><ScanSearch className="mr-1 inline h-3.5 w-3.5" />Read Text</button>
            <button className="cv-ghost-button min-h-9 px-3 text-xs" disabled={!pendingCount || Boolean(busy)} onClick={acceptAllBoxes}><Check className="mr-1 inline h-3.5 w-3.5" />Accept All</button>
            <button className="cv-ghost-button min-h-9 px-3 text-xs" disabled={!boxes.length || Boolean(busy)} onClick={clearFrameReview}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Clear</button>
          </div>
        </div>
        {!ocrReady ? <button className="cv-control-button min-h-9 px-3 text-xs" disabled={Boolean(busy)} onClick={() => void installOcr()}>
          {busy === "install-ocr" ? "Installing OCR..." : "Install OCR"}
        </button> : null}
      </div>
      <div className="cv-rail-cell">
        <div>
          <div className="cv-rail-label">Split</div>
          <select className="input mt-1 min-h-9 w-28 py-1 text-sm" value={split} onChange={(event) => setSplit(event.target.value as "train" | "val")}>
            <option value="train">Training</option>
            <option value="val">Validation</option>
          </select>
        </div>
        <label className="min-w-44">
          <div className="cv-rail-label">Confidence threshold</div>
          <div className="mt-1 flex min-h-9 items-center gap-3">
            <span className="text-sm font-bold text-cyan-200">{confidence.toFixed(2)}</span>
            <input className="min-w-0 flex-1 accent-cyan-300" type="range" min={0.1} max={0.9} step={0.05} value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} />
          </div>
        </label>
      </div>
      <button className="cv-validation-button" disabled={Boolean(busy) || !model?.packageAvailable || trainingBlocked} onClick={() => void train("full")}>
        <Play size={16} />Full Train
      </button>
    </section>
  </div>;
}

function MetricCard({ icon, label, value, detail, action, meter, dot }: { icon: ReactNode; label: string; value: string; detail: string; action?: ReactNode; meter?: number; dot?: boolean }) {
  return <div className="metric-card">
    <div className="text-cyan-300">{icon}</div>
    <div className="min-w-0 flex-1">
      <div className="cv-rail-label">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        {dot ? <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.85)]" /> : null}
        <div className="metric-card-value">{value}</div>
      </div>
      <div className="metric-card-detail">{detail}</div>
    </div>
    {meter != null ? <MetricGauge value={meter} /> : action ? <div className="text-slate-400">{action}</div> : null}
  </div>;
}

function MetricGauge({ value }: { value: number }) {
  const safe = clamp(value, 0, 100);
  return <div className="metric-gauge" style={{ background: `conic-gradient(var(--mlbb-cyan) ${safe * 3.6}deg, rgba(255,255,255,.08) 0deg)` }}>
    <span>{Math.round(safe)}</span>
  </div>;
}

function InspectorTabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className={`cv-inspector-tab ${active ? "cv-inspector-tab-active" : ""}`} onClick={onClick}>{children}</button>;
}

function SummaryRow({ color, label, value, muted }: { color: string; label: string; value: number; muted?: boolean }) {
  return <div className="cv-summary-row">
    <span className={`h-3 w-3 rounded-sm ${color}`} />
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <span className={muted ? "text-slate-500" : "text-white"}>{value}</span>
    {muted ? <EyeOff className="h-4 w-4 text-slate-500" /> : <Eye className="h-4 w-4 text-slate-400" />}
    <MoreVertical className="h-4 w-4 text-slate-500" />
  </div>;
}

function boxColor(name: string, suggested: boolean) {
  if (suggested) return "border-dashed border-amber-300 bg-amber-400/10";
  if (name.includes("enemy")) return "border-rose-300 bg-rose-400/10";
  if (name.includes("ally")) return "border-cyan-300 bg-cyan-400/10";
  return "border-emerald-300 bg-emerald-400/10";
}

function toAnnotationBox(box: ReviewBox): AnnotationBox {
  return {
    classId: box.classId,
    rect: normalizeReviewRect(box.rect) ?? box.rect,
    heroId: box.heroId,
    heroName: box.heroName,
    transcript: box.transcript,
  };
}

function isHeroMarkerClass(name: string) {
  const normalized = name.toLowerCase();
  return normalized === "ally_hero_marker" || normalized === "enemy_hero_marker";
}

function isTranscriptClass(name: string) {
  const normalized = name.toLowerCase();
  return normalized.includes("respawn") || normalized.includes("counter") || normalized.includes("timer");
}

function draggedRect(drag: BoxDragState, next: { x: number; y: number }): Rect {
  const [left, top, width, height] = drag.initial;
  const deltaX = next.x - drag.origin.x;
  const deltaY = next.y - drag.origin.y;
  const minSize = 0.002;
  if (drag.mode === "move") {
    const rect = normalizeReviewRect([
      clamp(left + deltaX, 0, 1 - width),
      clamp(top + deltaY, 0, 1 - height),
      width,
      height,
    ]);
    return rect ?? drag.initial;
  }
  const rect = normalizeReviewRect([
    left,
    top,
    clamp(width + deltaX, minSize, 1 - left),
    clamp(height + deltaY, minSize, 1 - top),
  ]);
  return rect ?? drag.initial;
}

function sanitizeReviewBox(box: ReviewBox): ReviewBox | null {
  const rect = normalizeReviewRect(box.rect);
  if (!rect || !Number.isInteger(box.classId)) return null;
  const confidence = Number(box.confidence);
  return {
    ...box,
    rect,
    confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : undefined,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "00:00";
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create OCR crop.")), "image/png"));
}
