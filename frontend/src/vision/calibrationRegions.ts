import { getObsConfig, getObsRegions } from "../api/client";

export type NormalizedRect = [number, number, number, number];
type RegionMap = Record<string, unknown>;

let activeRegions: RegionMap = {};
let activePresetName = "Default detector geometry";
let loaded = false;
let loading: Promise<RegionMap> | null = null;

function isNormalizedRect(value: unknown): value is NormalizedRect {
  return Array.isArray(value)
    && value.length === 4
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
}

function regionFromValue(value: unknown) {
  if (isNormalizedRect(value)) return value;
  if (Array.isArray(value)) return value.find(isNormalizedRect) ?? null;
  return null;
}

export function setActiveCalibrationRegions(regions: unknown, presetName = "Active calibration preset") {
  activeRegions = regions && typeof regions === "object" ? structuredClone(regions as RegionMap) : {};
  activePresetName = presetName;
  loaded = true;
}

export function resetActiveCalibrationRegions() {
  activeRegions = {};
  activePresetName = "Default detector geometry";
  loaded = false;
  loading = null;
}

export function calibratedRect(key: string, fallback: NormalizedRect) {
  return regionFromValue(activeRegions[key]) ?? fallback;
}

export function calibratedRectForKeys(keys: string[], fallback: NormalizedRect) {
  for (const key of keys) {
    const rect = regionFromValue(activeRegions[key]);
    if (rect) return rect;
  }
  return fallback;
}

export function optionalCalibratedRect(key: string) {
  return regionFromValue(activeRegions[key]);
}

export function activeCalibrationStatus() {
  return { loaded, presetName: activePresetName };
}

export async function refreshActiveCalibrationRegions() {
  if (loading) return loading;
  loading = Promise.all([getObsConfig().catch(() => ({})), getObsRegions().catch(() => ({}))]).then(([config, savedRegions]) => {
    const presets = Array.isArray(config?.calibrationPresets) ? config.calibrationPresets : [];
    const preset = presets.find((item: any) => item?.id === config?.activeCalibrationPresetId) ?? presets[0];
    const regions = preset?.regions && typeof preset.regions === "object" ? preset.regions : savedRegions;
    setActiveCalibrationRegions(regions, String(preset?.name ?? "Saved screen regions"));
    return activeRegions;
  }).finally(() => {
    loading = null;
  });
  return loading;
}

export function ensureActiveCalibrationRegions() {
  return loaded ? Promise.resolve(activeRegions) : refreshActiveCalibrationRegions();
}
