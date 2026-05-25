import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Brush, Circle, Crosshair, ImageDown, MousePointer2, RotateCcw, Save, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { getMapProjection, getMapZones, getObsRegions, saveMapProjection, saveMapZones, saveObsRegions } from "../api/client";
import { captureCurrentRuntimeFrame, useCaptureRuntimeStore } from "../runtime/captureRuntime";

type Point = [number, number];
type DrawMode = "polygon" | "freehand" | "oval";
type TrainerSection = "tactical" | "minimap-ai";
type CornerKey = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
type Zone = {
  id: string;
  name: string;
  type: string;
  polygon: Point[];
  drawMode?: DrawMode;
  dangerWeight: number;
  connectedZones?: string[];
};
type MinimapRoi = { x: number; y: number; w: number; h: number };
type MinimapCropTuning = { zoom: number; offsetX: number; offsetY: number };
type MinimapProjection = {
  mode: "bilinear_quad";
  source: "minimap-normalized-square";
  target: "tactical-map-normalized-rhombus";
  minimapCorners: Record<CornerKey, Point>;
  tacticalCorners: Record<CornerKey, Point>;
};

const tacticalMapReference = "/assets/map/mlbb-tactical-map-reference.png";
const fallbackMinimapRoi = { x: 0.02521, y: 0, w: 0.146359, h: 0.326563 };
const defaultProjection: MinimapProjection = {
  mode: "bilinear_quad",
  source: "minimap-normalized-square",
  target: "tactical-map-normalized-rhombus",
  minimapCorners: {
    topLeft: [0, 0],
    topRight: [1, 0],
    bottomRight: [1, 1],
    bottomLeft: [0, 1]
  },
  tacticalCorners: {
    topLeft: [0.18, 0.08],
    topRight: [0.80, 0.10],
    bottomRight: [0.88, 0.88],
    bottomLeft: [0.12, 0.86]
  }
};
const cornerLabels: Record<CornerKey, string> = {
  topLeft: "Top left",
  topRight: "Top right",
  bottomRight: "Bottom right",
  bottomLeft: "Bottom left"
};
const zoneTypeOptions = [
  { group: "Core", value: "semantic", label: "Semantic" },
  { group: "Core", value: "danger", label: "Danger" },
  { group: "Core", value: "vision", label: "Vision" },
  { group: "Terrain", value: "broken-wall", label: "Broken wall", detail: "broken-wall" },
  { group: "Terrain", value: "bush", label: "Bush", detail: "bush" },
  { group: "Terrain", value: "river", label: "River" },
  { group: "Terrain", value: "lane", label: "Lane" },
  { group: "Terrain", value: "jungle", label: "Jungle" },
  { group: "Terrain", value: "cyclone-eye", label: "Cyclone Eye", detail: "cyclone-eye" },
  { group: "Terrain", value: "magic-sentry", label: "Magic Sentry", detail: "magic-sentry" },
  { group: "Buildings", value: "ally-turret", label: "Ally turret", detail: "turret" },
  { group: "Buildings", value: "enemy-turret", label: "Enemy turret", detail: "turret" },
  { group: "Buildings", value: "enemy-turret-damage-zone", label: "Enemy turret damage zone", detail: "turret-damage-zone" },
  { group: "Buildings", value: "outer-turret", label: "Outer turret", detail: "outer-turret" },
  { group: "Buildings", value: "inner-turret", label: "Inner turret", detail: "inner-turret" },
  { group: "Buildings", value: "base-turret", label: "Base turret", detail: "base-turret" },
  { group: "Buildings", value: "ally-base", label: "Ally base", detail: "base" },
  { group: "Buildings", value: "enemy-base", label: "Enemy base", detail: "base" },
  { group: "Creeps", value: "jungle-creep", label: "Jungle creep" },
  { group: "Creeps", value: "ally-jungle-creep", label: "Ally jungle creep" },
  { group: "Creeps", value: "enemy-jungle-creep", label: "Enemy jungle creep" },
  { group: "Creeps", value: "scavenger-crab", label: "Scavenger Crab", detail: "scavenger-crab" },
  { group: "Creeps", value: "lithowanderer", label: "Lithowanderer", detail: "lithowanderer" },
  { group: "Creeps", value: "molten-fiend", label: "Molten Fiend", detail: "molten-fiend" },
  { group: "Creeps", value: "fire-beetle", label: "Fire Beetle", detail: "fire-beetle" },
  { group: "Creeps", value: "lava-golem", label: "Lava Golem", detail: "lava-golem" },
  { group: "Creeps", value: "thunder-fenrir", label: "Thunder Fenrir", detail: "thunder-fenrir" },
  { group: "Creeps", value: "horned-lizard", label: "Horned Lizard", detail: "horned-lizard" },
  { group: "Objectives", value: "objective", label: "Objective" },
  { group: "Objectives", value: "dragon-turtle", label: "Dragon Turtle", detail: "dragon-turtle" },
  { group: "Objectives", value: "elemental-lord", label: "Elemental Lord", detail: "elemental-lord" }
];
const zoneTypeGroups = zoneTypeOptions.reduce<Record<string, typeof zoneTypeOptions>>((acc, option) => {
  acc[option.group] = [...(acc[option.group] ?? []), option];
  return acc;
}, {});
const minimapLabels = ["ally-hero", "enemy-hero", "objective", "turret", "jungle-camp", "lane-minion", "dangerous-grass", "broken-wall", "flying-cloud", "expanding-river"];
const tacticalZoomLevels = [1, 1.25, 1.5, 2, 3, 4, 6];
const tutorialDetails: Record<string, { title: string; timing?: string; summary: string }> = {
  "cyclone-eye": { title: "Cyclone Eye", timing: "First spawn 40s, respawn 45s", summary: "After a brief 1.2s stay, heroes glide forward and can pass through some obstacles." },
  bush: { title: "Bush", timing: "Invisible after 1s if no enemy is inside", summary: "Entering a bush hides the hero until they deal damage or are otherwise revealed." },
  "magic-sentry": { title: "Magic Sentry", timing: "Appears after a side-lane inner turret is destroyed, recharges 90s", summary: "Standing on it lights nearby jungle for 6s and reveals invisible units." },
  "scavenger-crab": { title: "Scavenger Crab", timing: "First spawn 42s, respawn 45s", summary: "Gold lane grants a coin for gold; Exp lane grants a scroll for experience." },
  lithowanderer: { title: "Lithowanderer", timing: "First spawn 48s, respawn 60s, patrol 45s", summary: "Grants river movement speed, mana sustain, and a Stone Roamer that exposes enemies in range." },
  "molten-fiend": { title: "Molten Fiend", timing: "First spawn 25s, respawn 90s", summary: "Red-side buff grants adaptive penetration and role-based true-damage slow on enemy heroes." },
  "fire-beetle": { title: "Fire Beetle", timing: "First spawn 39s, respawn 70s", summary: "Restores HP and mana on kill, then releases a weaker Little Fire Beetle." },
  "lava-golem": { title: "Lava Golem", timing: "First spawn 31s, respawn 70s", summary: "Restores HP and mana on kill; otherwise a simple common camp." },
  "thunder-fenrir": { title: "Thunder Fenrir", timing: "First spawn 25s, respawn 90s", summary: "Blue-side buff reduces cooldown and resource costs, with Soul of Wind sustain." },
  "horned-lizard": { title: "Horned Lizard", timing: "First spawn 40s, respawn 70s", summary: "Restores HP and mana on kill and gains extra defenses below 50% HP." },
  "dragon-turtle": { title: "Dragon Turtle", timing: "First spawn 2m, respawn 2m, stops after 8m", summary: "Grants shield and offensive stats; its first spawn also determines EXP and Gold side-lane features." },
  "elemental-lord": { title: "Elemental Lord", timing: "First spawn after 8m, evolves at 18m", summary: "Joins the killer's team to push the weakest lane and gains stronger siege effects after evolving." },
  turret: { title: "Turret", timing: "Sight 8 units, attack range 5 units", summary: "Turrets stack 75% increased damage on the same hero and gain 50% damage reduction without enemy minions nearby." },
  "turret-damage-zone": { title: "Enemy turret damage zone", timing: "Attack range 5 units", summary: "Use this for dive warnings and offset-sensitive threat projection around enemy structures." },
  "outer-turret": { title: "Outer Turret", timing: "Energy shield during first 5m", summary: "Gold-lane shield protection is stronger in Mythical Honor+, while Exp and Mid nearby hero reduction is weaker." },
  "inner-turret": { title: "Inner Turret", timing: "Protection during first 8m", summary: "Mythical Honor+ increases inner turret HP from 5700 to 6700." },
  "base-turret": { title: "Base Turret", timing: "Protection during first 12m", summary: "Mythical Honor+ increases base turret HP from 7300 to 8200." },
  base: { title: "Base", timing: "Sight 8 units, attack range 5 units", summary: "Mythical Honor+ increases base HP from 7900 to 9000; base self-repairs over time." }
};
const colors: Record<string, { stroke: string; fill: string }> = {
  "broken-wall": { stroke: "#22c55e", fill: "rgba(34,197,94,.18)" },
  bush: { stroke: "#84cc16", fill: "rgba(132,204,22,.18)" },
  river: { stroke: "#38bdf8", fill: "rgba(56,189,248,.18)" },
  objective: { stroke: "#f59e0b", fill: "rgba(245,158,11,.18)" },
  "dragon-turtle": { stroke: "#14b8a6", fill: "rgba(20,184,166,.18)" },
  "elemental-lord": { stroke: "#fbbf24", fill: "rgba(251,191,36,.18)" },
  jungle: { stroke: "#10b981", fill: "rgba(16,185,129,.16)" },
  "jungle-creep": { stroke: "#34d399", fill: "rgba(52,211,153,.16)" },
  "ally-jungle-creep": { stroke: "#38bdf8", fill: "rgba(56,189,248,.16)" },
  "enemy-jungle-creep": { stroke: "#fb7185", fill: "rgba(251,113,133,.16)" },
  "scavenger-crab": { stroke: "#facc15", fill: "rgba(250,204,21,.16)" },
  lithowanderer: { stroke: "#2dd4bf", fill: "rgba(45,212,191,.16)" },
  "molten-fiend": { stroke: "#fb923c", fill: "rgba(251,146,60,.18)" },
  "fire-beetle": { stroke: "#f97316", fill: "rgba(249,115,22,.18)" },
  "lava-golem": { stroke: "#c2410c", fill: "rgba(194,65,12,.18)" },
  "thunder-fenrir": { stroke: "#818cf8", fill: "rgba(129,140,248,.18)" },
  "horned-lizard": { stroke: "#c084fc", fill: "rgba(192,132,252,.16)" },
  lane: { stroke: "#a78bfa", fill: "rgba(167,139,250,.16)" },
  danger: { stroke: "#f43f5e", fill: "rgba(244,63,94,.16)" },
  vision: { stroke: "#e879f9", fill: "rgba(232,121,249,.16)" },
  "cyclone-eye": { stroke: "#67e8f9", fill: "rgba(103,232,249,.18)" },
  "magic-sentry": { stroke: "#60a5fa", fill: "rgba(96,165,250,.18)" },
  "ally-turret": { stroke: "#38bdf8", fill: "rgba(56,189,248,.15)" },
  "enemy-turret": { stroke: "#fb7185", fill: "rgba(251,113,133,.16)" },
  "enemy-turret-damage-zone": { stroke: "#ef4444", fill: "rgba(239,68,68,.13)" },
  "outer-turret": { stroke: "#93c5fd", fill: "rgba(147,197,253,.14)" },
  "inner-turret": { stroke: "#60a5fa", fill: "rgba(96,165,250,.14)" },
  "base-turret": { stroke: "#2563eb", fill: "rgba(37,99,235,.14)" },
  "ally-base": { stroke: "#22d3ee", fill: "rgba(34,211,238,.14)" },
  "enemy-base": { stroke: "#f87171", fill: "rgba(248,113,113,.14)" },
  semantic: { stroke: "#93c5fd", fill: "rgba(147,197,253,.16)" }
};

function toPath(points: Point[]) {
  if (!points.length) return "";
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x * 100} ${y * 100}`).join(" ") + " Z";
}

function smoothFreehand(points: Point[]) {
  if (points.length <= 80) return points;
  const step = Math.ceil(points.length / 80);
  return points.filter((_, index) => index % step === 0);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeProjection(value: unknown): MinimapProjection {
  const projection = value as Partial<MinimapProjection> | undefined;
  return {
    ...defaultProjection,
    minimapCorners: { ...defaultProjection.minimapCorners, ...(projection?.minimapCorners ?? {}) },
    tacticalCorners: { ...defaultProjection.tacticalCorners, ...(projection?.tacticalCorners ?? {}) }
  };
}

function ellipsePoints(start: Point, end: Point, segments = 64) {
  const cx = (start[0] + end[0]) / 2;
  const cy = (start[1] + end[1]) / 2;
  const rx = Math.abs(end[0] - start[0]) / 2;
  const ry = Math.abs(end[1] - start[1]) / 2;
  if (rx < 0.002 || ry < 0.002) return [start, end];
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [clamp01(cx + Math.cos(angle) * rx), clamp01(cy + Math.sin(angle) * ry)] as Point;
  });
}

function projectionPath(corners: Record<CornerKey, Point>) {
  return toPath([corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]);
}

function readMinimapRoi(value: unknown): MinimapRoi | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  return { x: value[0], y: value[1], w: value[2], h: value[3] };
}

function squareCropFromRoi(bitmap: ImageBitmap, roi: MinimapRoi, tuning: MinimapCropTuning = { zoom: 1, offsetX: 0, offsetY: 0 }) {
  const x = Math.max(0, Math.round(bitmap.width * roi.x));
  const y = Math.max(0, Math.round(bitmap.height * roi.y));
  const w = Math.max(1, Math.min(bitmap.width - x, Math.round(bitmap.width * roi.w)));
  const h = Math.max(1, Math.min(bitmap.height - y, Math.round(bitmap.height * roi.h)));
  const baseSide = Math.max(1, Math.min(w, h));
  const side = Math.max(1, Math.min(bitmap.width, bitmap.height, Math.round(baseSide / tuning.zoom)));
  return {
    sx: Math.max(0, Math.min(bitmap.width - side, x + Math.round((w - side) / 2) + tuning.offsetX)),
    sy: Math.max(0, Math.min(bitmap.height - side, y + Math.round((h - side) / 2) + tuning.offsetY)),
    side
  };
}

export function MapTrainer() {
  const frameUrlRef = useRef("");
  const minimapUrlRef = useRef("");
  const minimapFrameBlobRef = useRef<Blob | null>(null);
  const minimapRoiRef = useRef<MinimapRoi>(fallbackMinimapRoi);
  const minimapRoiSourceRef = useRef("fallback");
  const boardRef = useRef<HTMLDivElement | null>(null);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const ovalStartRef = useRef<Point | null>(null);
  const [section, setSection] = useState<TrainerSection>("tactical");
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Point[]>([]);
  const [mode, setMode] = useState<DrawMode>("freehand");
  const [name, setName] = useState("Broken wall zone");
  const [type, setType] = useState("broken-wall");
  const [dangerWeight, setDangerWeight] = useState(0.6);
  const [frameUrl, setFrameUrl] = useState("");
  const [frameSize, setFrameSize] = useState({ width: 2856, height: 1280 });
  const [minimapUrl, setMinimapUrl] = useState("");
  const [minimapSize, setMinimapSize] = useState({ width: 512, height: 512 });
  const [minimapCropNote, setMinimapCropNote] = useState("minimap ROI");
  const [minimapCropTuning, setMinimapCropTuning] = useState<MinimapCropTuning>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [minimapCropPixels, setMinimapCropPixels] = useState({ x: 0, y: 0, side: 0, sourceWidth: 2856, sourceHeight: 1280 });
  const [minimapLabel, setMinimapLabel] = useState("ally-hero");
  const [minimapSamples, setMinimapSamples] = useState<Array<{ id: string; label: string; width: number; height: number }>>([]);
  const [projection, setProjection] = useState<MinimapProjection>(defaultProjection);
  const [activeCorner, setActiveCorner] = useState<CornerKey | "">("");
  const [tacticalZoom, setTacticalZoom] = useState(1);
  const runtime = useCaptureRuntimeStore();
  const selected = zones.find((zone) => zone.id === selectedId);
  const selectedZoneType = zoneTypeOptions.find((option) => option.value === type);
  const selectedZoneDetail = selectedZoneType?.detail ? tutorialDetails[selectedZoneType.detail] : tutorialDetails[type];
  const selectedCorner: CornerKey = activeCorner || "topLeft";

  useEffect(() => {
    void loadZones();
    void loadProjection();
    return () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      if (minimapUrlRef.current) URL.revokeObjectURL(minimapUrlRef.current);
    };
  }, []);

  async function loadZones() {
    const result = await getMapZones();
    setZones(result.data ?? []);
  }

  async function loadProjection() {
    const result = await getMapProjection().catch(() => ({ data: defaultProjection }));
    setProjection(normalizeProjection(result.data));
  }

  async function getSelectedSourceFrame() {
    const frame = await captureCurrentRuntimeFrame();
    if (frame) return { blob: frame.blob, source: `${frame.mode} / ${frame.source}` };
    if (runtime.selectedSource !== "adb") throw new Error(`Start Live Capture for ${runtime.selectedSource} before pulling a trainer frame.`);
    const response = await fetch(`/api/capture/frame?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    return { blob: await response.blob(), source: "selected ADB source" };
  }

  async function loadTacticalCaptureFrame() {
    const { blob } = await getSelectedSourceFrame();
    const bitmap = await createImageBitmap(blob);
    setFrameSize({ width: bitmap.width, height: bitmap.height });
    bitmap.close();
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    const url = URL.createObjectURL(blob);
    frameUrlRef.current = url;
    setFrameUrl(url);
  }

  async function loadMinimapFrame() {
    const { blob, source } = await getSelectedSourceFrame();
    let roi = fallbackMinimapRoi;
    let roiSource = `${source} fallback`;
    try {
      const savedRegions = await getObsRegions();
      const savedRoi = readMinimapRoi(savedRegions?.minimap_norm);
      if (savedRoi) {
        roi = savedRoi;
        roiSource = `${source} calibrated`;
      }
    } catch {}
    minimapFrameBlobRef.current = blob;
    minimapRoiRef.current = roi;
    minimapRoiSourceRef.current = roiSource;
    await renderMinimapCrop(blob, roi, roiSource, minimapCropTuning);
  }

  async function renderMinimapCrop(blob = minimapFrameBlobRef.current, roi = minimapRoiRef.current, roiSource = minimapRoiSourceRef.current, tuning = minimapCropTuning) {
    if (!blob) return;
    const bitmap = await createImageBitmap(blob);
    const { sx, sy, side } = squareCropFromRoi(bitmap, roi, tuning);
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, sx, sy, side, side, 0, 0, side, side);
    bitmap.close();
    const crop = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!crop) return;
    if (minimapUrlRef.current) URL.revokeObjectURL(minimapUrlRef.current);
    const url = URL.createObjectURL(crop);
    minimapUrlRef.current = url;
    setMinimapUrl(url);
    setMinimapSize({ width: side, height: side });
    setMinimapCropPixels({ x: sx, y: sy, side, sourceWidth, sourceHeight });
    setMinimapCropNote(`${roiSource} crop x${sx} y${sy}`);
  }

  function updateMinimapCropTuning(next: Partial<MinimapCropTuning>) {
    const tuning = { ...minimapCropTuning, ...next };
    setMinimapCropTuning(tuning);
    void renderMinimapCrop(minimapFrameBlobRef.current, minimapRoiRef.current, minimapRoiSourceRef.current, tuning);
  }

  async function saveMinimapCalibration() {
    const existing = await getObsRegions().catch(() => ({}));
    const { x, y, side, sourceWidth, sourceHeight } = minimapCropPixels;
    if (!side || !sourceWidth || !sourceHeight) return;
    const minimap_norm = [
      Number((x / sourceWidth).toFixed(6)),
      Number((y / sourceHeight).toFixed(6)),
      Number((side / sourceWidth).toFixed(6)),
      Number((side / sourceHeight).toFixed(6))
    ];
    await saveObsRegions({ ...existing, minimap_norm });
    minimapRoiRef.current = { x: minimap_norm[0], y: minimap_norm[1], w: minimap_norm[2], h: minimap_norm[3] };
    minimapRoiSourceRef.current = "saved";
    setMinimapCropTuning({ zoom: 1, offsetX: 0, offsetY: 0 });
    await renderMinimapCrop(minimapFrameBlobRef.current, minimapRoiRef.current, "saved", { zoom: 1, offsetX: 0, offsetY: 0 });
  }

  function pointFromEvent(event: PointerEvent): Point {
    const rect = boardRef.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    ];
  }

  function changeTacticalZoom(direction: 1 | -1) {
    setTacticalZoom((current) => {
      const index = tacticalZoomLevels.findIndex((item) => item >= current);
      const nextIndex = Math.max(0, Math.min(tacticalZoomLevels.length - 1, (index === -1 ? 0 : index) + direction));
      return tacticalZoomLevels[nextIndex];
    });
  }

  function resetTacticalZoom() {
    setTacticalZoom(1);
    boardViewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!boardRef.current) return;
    const point = pointFromEvent(event);
    if (activeCorner) {
      setProjection((current) => ({
        ...current,
        tacticalCorners: { ...current.tacticalCorners, [activeCorner]: point }
      }));
      return;
    }
    if (mode === "polygon") {
      setDraft((points) => [...points, point]);
      return;
    }
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "oval") {
      ovalStartRef.current = point;
      setDraft(ellipsePoints(point, point));
      return;
    }
    setDraft([point]);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    if (mode === "oval" && ovalStartRef.current) {
      setDraft(ellipsePoints(ovalStartRef.current, point));
      return;
    }
    if (mode !== "freehand") return;
    setDraft((points) => {
      const last = points.at(-1);
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.006) return points;
      return [...points, point];
    });
  }

  function pointerUp() {
    drawingRef.current = false;
    ovalStartRef.current = null;
  }

  function saveDraft() {
    const polygon = mode === "freehand" ? smoothFreehand(draft) : draft;
    if (polygon.length < 3) return;
    const zone: Zone = {
      id: selectedId || `${type}-${Date.now()}`,
      name,
      type,
      polygon,
      drawMode: mode,
      dangerWeight,
      connectedZones: selected?.connectedZones ?? []
    };
    setZones((items) => selectedId ? items.map((item) => item.id === selectedId ? zone : item) : [...items, zone]);
    setSelectedId(zone.id);
    setDraft([]);
  }

  async function persistProjection() {
    const result = await saveMapProjection(projection);
    setProjection(normalizeProjection(result.data));
  }

  function updateTacticalCorner(key: CornerKey, index: 0 | 1, value: number) {
    setProjection((current) => {
      const point = [...current.tacticalCorners[key]] as Point;
      point[index] = clamp01(value);
      return { ...current, tacticalCorners: { ...current.tacticalCorners, [key]: point } };
    });
  }

  async function persist() {
    const result = await saveMapZones(zones);
    setZones(result.data ?? zones);
  }

  function addMinimapSample() {
    if (!minimapUrl) return;
    setMinimapSamples((items) => [
      { id: `${minimapLabel}-${Date.now()}`, label: minimapLabel, width: minimapSize.width, height: minimapSize.height },
      ...items
    ]);
  }

  function editZone(zone: Zone) {
    setSelectedId(zone.id);
    setName(zone.name);
    setType(zone.type);
    setDangerWeight(zone.dangerWeight);
    setMode(zone.drawMode ?? "polygon");
    setDraft(zone.polygon);
  }

  function deleteZone() {
    if (!selectedId) return;
    setZones((items) => items.filter((zone) => zone.id !== selectedId));
    setSelectedId("");
    setDraft([]);
  }

  const draftColor = colors[type] ?? colors.semantic;
  const counts = useMemo(() => zones.reduce<Record<string, number>>((acc, zone) => ({ ...acc, [zone.type]: (acc[zone.type] ?? 0) + 1 }), {}), [zones]);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-3xl font-black">Map Trainer</h2>
        <p className="text-slate-400">Separate tactical-map zone editing from minimap AI recognition training.</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-1 sm:w-auto">
        <button className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold ${section === "tactical" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSection("tactical")}><Crosshair className="mr-2 inline h-4 w-4" />Tactical Map</button>
        <button className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold ${section === "minimap-ai" ? "bg-violet-500 text-white" : "text-slate-300"}`} onClick={() => setSection("minimap-ai")}><Brain className="mr-2 inline h-4 w-4" />Minimap AI</button>
      </div>
    </div>

    {section === "tactical" ? <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_380px]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
          <div>
            <h3 className="font-bold">Tactical Map Zones</h3>
            <p className="text-xs text-slate-400">Draw semantic regions on the full tactical reference, not the minimap crop.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/5">
              <button className="grid min-h-11 w-11 place-items-center text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={() => changeTacticalZoom(-1)} disabled={tacticalZoom <= tacticalZoomLevels[0]} title="Zoom out"><ZoomOut className="h-4 w-4" /></button>
              <div className="grid min-h-11 min-w-16 place-items-center border-x border-white/10 px-3 text-sm font-bold text-cyan-100">{Math.round(tacticalZoom * 100)}%</div>
              <button className="grid min-h-11 w-11 place-items-center text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={() => changeTacticalZoom(1)} disabled={tacticalZoom >= tacticalZoomLevels[tacticalZoomLevels.length - 1]} title="Zoom in"><ZoomIn className="h-4 w-4" /></button>
              <button className="grid min-h-11 w-11 place-items-center text-slate-200 hover:bg-white/10" onClick={resetTacticalZoom} title="Reset zoom"><RotateCcw className="h-4 w-4" /></button>
            </div>
            <button className="btn inline-flex items-center gap-2" onClick={loadTacticalCaptureFrame}><ImageDown className="h-4 w-4" />Live Frame</button>
            <button className="btn inline-flex items-center gap-2" onClick={persist}><Save className="h-4 w-4" />Save Zones</button>
          </div>
        </div>
        <div ref={boardViewportRef} className="touch-scroll max-h-[72vh] overflow-auto bg-[#020711]">
          <div ref={boardRef} className="relative touch-none select-none bg-[#020711]" style={{ aspectRatio: `${frameSize.width} / ${frameSize.height}`, width: `${tacticalZoom * 100}%`, minWidth: "720px" }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
            <img src={frameUrl || tacticalMapReference} alt="" className="absolute inset-0 h-full w-full object-fill opacity-95" draggable={false} />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {zones.map((zone) => {
                const color = colors[zone.type] ?? colors.semantic;
                return <path key={zone.id} d={toPath(zone.polygon)} fill={color.fill} stroke={color.stroke} strokeWidth={selectedId === zone.id ? 0.8 : 0.45} vectorEffect="non-scaling-stroke" />;
              })}
              <path d={projectionPath(projection.tacticalCorners)} fill="rgba(34,211,238,.06)" stroke="#22d3ee" strokeDasharray="1.5 1.5" strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
              {(Object.entries(projection.tacticalCorners) as Array<[CornerKey, Point]>).map(([key, [x, y]]) => <g key={key}>
                <circle cx={x * 100} cy={y * 100} r={activeCorner === key ? 1.15 : 0.8} fill={activeCorner === key ? "#fbbf24" : "#22d3ee"} stroke="#020617" strokeWidth={0.25} vectorEffect="non-scaling-stroke" />
              </g>)}
              {draft.length > 1 && <path d={toPath(draft)} fill={draftColor.fill} stroke={draftColor.stroke} strokeDasharray={mode === "polygon" ? "2 1.5" : undefined} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />}
              {draft.map(([x, y], index) => <circle key={`${x}-${y}-${index}`} cx={x * 100} cy={y * 100} r={0.55} fill={draftColor.stroke} vectorEffect="non-scaling-stroke" />)}
            </svg>
            <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-2 text-xs text-slate-200">{activeCorner ? `Click tactical ${cornerLabels[activeCorner]} edge` : frameUrl ? `${frameSize.width}x${frameSize.height}` : "Full tactical map reference"}</div>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <h3 className="font-bold">Draw Zone</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${mode === "freehand" ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => setMode("freehand")}><Brush className="mr-2 inline h-4 w-4" />Freehand</button>
            <button className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${mode === "polygon" ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => setMode("polygon")}><MousePointer2 className="mr-2 inline h-4 w-4" />Polygon</button>
            <button className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${mode === "oval" ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => setMode("oval")}><Circle className="mr-2 inline h-4 w-4" />Oval</button>
          </div>
          <input className="input mt-3 w-full" value={name} onChange={(event) => setName(event.target.value)} />
          <select className="input mt-3 w-full" value={type} onChange={(event) => setType(event.target.value)}>
            {Object.entries(zoneTypeGroups).map(([group, options]) => <optgroup key={group} label={group}>
              {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </optgroup>)}
          </select>
          {selectedZoneDetail && <div className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-500/10 p-3 text-xs text-slate-200">
            <div className="font-bold text-cyan-100">{selectedZoneDetail.title}</div>
            {selectedZoneDetail.timing && <div className="mt-1 text-cyan-200/80">{selectedZoneDetail.timing}</div>}
            <div className="mt-2 text-slate-300">{selectedZoneDetail.summary}</div>
          </div>}
          <label className="mt-3 block text-sm text-slate-300">Danger weight {dangerWeight.toFixed(2)}</label>
          <input className="mt-2 w-full" type="range" min="0" max="1" step="0.05" value={dangerWeight} onChange={(event) => setDangerWeight(Number(event.target.value))} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn" onClick={saveDraft} disabled={draft.length < 3}>{selectedId ? "Update" : "Add"} Zone</button>
            <button className="min-h-11 rounded-lg bg-white/10 px-3 py-2" onClick={() => { setDraft([]); setSelectedId(""); }}>New</button>
          </div>
          <button className="mt-2 min-h-11 w-full rounded-lg bg-red-500/20 px-3 py-2 text-red-100" onClick={deleteZone} disabled={!selectedId}><Trash2 className="mr-2 inline h-4 w-4" />Delete Selected</button>
        </div>

        <div className="card p-4">
          <h3 className="font-bold">Tactical Map Edges</h3>
          <p className="mt-1 text-xs text-slate-400">Pick a corner, then click the real tactical-map edge. These corners drive minimap-to-tactical offset projection.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(cornerLabels) as CornerKey[]).map((key) => <button key={key} className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${activeCorner === key ? "border-amber-300 bg-amber-500/20 text-amber-50" : "border-white/10 bg-white/5"}`} onClick={() => setActiveCorner(activeCorner === key ? "" : key)}>{cornerLabels[key]}</button>)}
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-sm font-bold">{cornerLabels[selectedCorner]}</div>
            <label className="block text-xs text-slate-300">
              X {projection.tacticalCorners[selectedCorner][0].toFixed(4)}
              <input className="mt-1 w-full" type="range" min="0" max="1" step="0.001" value={projection.tacticalCorners[selectedCorner][0]} onChange={(event) => updateTacticalCorner(selectedCorner, 0, Number(event.target.value))} />
            </label>
            <label className="mt-3 block text-xs text-slate-300">
              Y {projection.tacticalCorners[selectedCorner][1].toFixed(4)}
              <input className="mt-1 w-full" type="range" min="0" max="1" step="0.001" value={projection.tacticalCorners[selectedCorner][1]} onChange={(event) => updateTacticalCorner(selectedCorner, 1, Number(event.target.value))} />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="min-h-11 rounded-lg bg-white/10 px-3 py-2 text-sm font-bold" onClick={() => setProjection(defaultProjection)}>Reset</button>
            <button className="btn inline-flex items-center justify-center gap-2" onClick={persistProjection}><Save className="h-4 w-4" />Save Edges</button>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-bold">Saved Zones</h3>
          <div className="mt-2 flex flex-wrap gap-1">{Object.entries(counts).map(([zoneType, count]) => <span className="chip" key={zoneType}>{zoneType}: {count}</span>)}</div>
          <div className="touch-scroll mt-3 max-h-[48vh] overflow-auto pr-1">
            {zones.map((zone) => {
              const color = colors[zone.type] ?? colors.semantic;
              return <button key={zone.id} className={`mb-2 w-full rounded-lg border p-3 text-left ${selectedId === zone.id ? "border-violet-300 bg-violet-500/20" : "border-white/10 bg-white/5"}`} onClick={() => editZone(zone)}>
                <div className="flex items-center justify-between gap-3"><b>{zone.name}</b><span className="text-xs" style={{ color: color.stroke }}>{zone.type}</span></div>
                <div className="mt-1 text-xs text-slate-400">{zone.polygon.length} points / danger {zone.dangerWeight}</div>
              </button>;
            })}
          </div>
        </div>
      </aside>
    </div> : <div className="grid gap-4 xl:grid-cols-[minmax(320px,1fr)_380px]">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 p-3">
          <div>
            <h3 className="font-bold">Minimap AI Training</h3>
            <p className="text-xs text-slate-400">Crop the live minimap, label samples, then project detections onto the tactical map runtime.</p>
          </div>
          <button className="btn inline-flex items-center gap-2" onClick={loadMinimapFrame}><ImageDown className="h-4 w-4" />Pull Minimap Frame</button>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(260px,520px)_1fr]">
          <div>
            <div className="relative aspect-square overflow-hidden rounded-xl border border-cyan-300/20 bg-black">
              {minimapUrl ? <img className="h-full w-full object-fill" src={minimapUrl} alt="" draggable={false} /> : <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-400">Pull a native capture frame to crop the minimap ROI for AI samples.</div>}
              <div className="absolute left-3 top-3 rounded-lg bg-black/65 px-3 py-2 text-xs text-slate-200">{minimapUrl ? `${minimapSize.width}x${minimapSize.height} - ${minimapCropNote}` : "minimap ROI"}</div>
            </div>
            {minimapUrl && <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="grid gap-3 text-xs text-slate-300">
                <label>
                  <div className="mb-1 flex items-center justify-between gap-3"><span>Zoom</span><b>{minimapCropTuning.zoom.toFixed(2)}x</b></div>
                  <input className="w-full" type="range" min="0.94" max="1.08" step="0.005" value={minimapCropTuning.zoom} onChange={(event) => updateMinimapCropTuning({ zoom: Number(event.target.value) })} />
                </label>
                <label>
                  <div className="mb-1 flex items-center justify-between gap-3"><span>Left / right</span><b>{minimapCropTuning.offsetX}px</b></div>
                  <input className="w-full" type="range" min="-32" max="32" step="1" value={minimapCropTuning.offsetX} onChange={(event) => updateMinimapCropTuning({ offsetX: Number(event.target.value) })} />
                </label>
                <label>
                  <div className="mb-1 flex items-center justify-between gap-3"><span>Top / bottom</span><b>{minimapCropTuning.offsetY}px</b></div>
                  <input className="w-full" type="range" min="-32" max="32" step="1" value={minimapCropTuning.offsetY} onChange={(event) => updateMinimapCropTuning({ offsetY: Number(event.target.value) })} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="min-h-11 rounded-lg bg-white/10 px-3 py-2 text-sm font-bold" onClick={() => updateMinimapCropTuning({ zoom: 1, offsetX: 0, offsetY: 0 })}>Reset</button>
                <button className="btn inline-flex items-center justify-center gap-2" onClick={saveMinimapCalibration}><Save className="h-4 w-4" />Save Crop</button>
              </div>
            </div>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select className="input w-full" value={minimapLabel} onChange={(event) => setMinimapLabel(event.target.value)}>{minimapLabels.map((item) => <option key={item}>{item}</option>)}</select>
              <button className="btn" onClick={addMinimapSample} disabled={!minimapUrl}>Add Sample</button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h4 className="font-bold">AI Recognition Targets</h4>
              <div className="mt-3 flex flex-wrap gap-2">{minimapLabels.map((item) => <button key={item} className={`chip ${minimapLabel === item ? "border-cyan-300 bg-cyan-500/20 text-cyan-100" : ""}`} onClick={() => setMinimapLabel(item)}>{item}</button>)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h4 className="font-bold">Projection Path</h4>
              <div className="mt-3 grid gap-2 text-sm text-slate-300">
                <div className="rounded-lg bg-black/25 p-3">1. Detect marker/icon in minimap coordinates.</div>
                <div className="rounded-lg bg-black/25 p-3">2. Normalize to square minimap x/y.</div>
                <div className="rounded-lg bg-black/25 p-3">3. Warp through minimap-to-tactical projection.</div>
                <div className="rounded-lg bg-black/25 p-3">4. Resolve tactical semantic zone and coaching event.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="card p-4">
        <h3 className="font-bold">Minimap Samples</h3>
        <p className="mt-1 text-xs text-slate-400">These are AI dataset entries, separate from tactical semantic zones.</p>
        <div className="touch-scroll mt-3 max-h-[66vh] overflow-auto pr-1">
          {minimapSamples.length === 0 && <div className="rounded-lg bg-white/5 p-3 text-sm text-slate-400">No minimap samples in this browser session yet.</div>}
          {minimapSamples.map((sample) => <div className="mb-2 rounded-lg border border-white/10 bg-white/5 p-3" key={sample.id}>
            <div className="font-bold">{sample.label}</div>
            <div className="mt-1 text-xs text-slate-400">{sample.width}x{sample.height} minimap crop</div>
          </div>)}
        </div>
      </aside>
    </div>}
  </div>;
}
