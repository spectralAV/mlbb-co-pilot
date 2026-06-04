import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(process.cwd(), "..");
const adbRoot = path.join(projectRoot, "data", "adb-assets");
const layoutGraphPath = path.join(adbRoot, "ui-layout-graph.json");
const defaultUiRoot = path.join(adbRoot, "library", "UI", "android");
const extractorScript = path.resolve(process.cwd(), "tools", "extractUnityUILayout.py");

export type UiLayoutGraphSummary = {
  ready: boolean;
  path: string;
  uiLibraryRoot: string;
  createdAt: string | null;
  scope: string | null;
  engine: string | null;
  taxonomy: string | null;
  bundlesScanned: number;
  bundlesWithNodes: number;
  totalNodes: number;
  pickSlotNodes: number;
  banSlotNodes: number;
  draftStateMarkers: number;
  screens: Record<string, number>;
  elementKinds: Record<string, number>;
  bytes: number;
  extractorScript: string;
};

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function getUiLayoutGraphSummary(): Promise<UiLayoutGraphSummary> {
  const ready = await exists(layoutGraphPath);
  if (!ready) {
    return {
      ready: false,
      path: layoutGraphPath,
      uiLibraryRoot: defaultUiRoot,
      createdAt: null,
      scope: null,
      engine: null,
      taxonomy: null,
      bundlesScanned: 0,
      bundlesWithNodes: 0,
      totalNodes: 0,
      pickSlotNodes: 0,
      banSlotNodes: 0,
      draftStateMarkers: 0,
      screens: {},
      elementKinds: {},
      bytes: 0,
      extractorScript,
    };
  }
  const [raw, fileStat] = await Promise.all([
    readFile(layoutGraphPath, "utf8"),
    stat(layoutGraphPath),
  ]);
  const graph = JSON.parse(raw) as {
    createdAt?: string;
    scope?: string;
    engine?: string;
    taxonomy?: string;
    inventory?: { bundlesScanned?: number; bundlesWithNodes?: number; totalNodes?: number };
    bundles?: Array<{
      screen?: string;
      draftUiStates?: string[];
      nodes?: Array<{ copilotClassHint?: string | null; elementKind?: string }>;
    }>;
  };
  let pickSlotNodes = 0;
  let banSlotNodes = 0;
  let draftStateMarkers = 0;
  const screens: Record<string, number> = {};
  const elementKinds: Record<string, number> = {};
  for (const bundle of graph.bundles ?? []) {
    const screen = bundle.screen ?? "other";
    screens[screen] = (screens[screen] ?? 0) + 1;
    draftStateMarkers += bundle.draftUiStates?.length ?? 0;
    for (const node of bundle.nodes ?? []) {
      if (node.copilotClassHint === "ally_pick_slot" || node.copilotClassHint === "enemy_pick_slot") pickSlotNodes += 1;
      if (node.copilotClassHint === "ally_ban_slot" || node.copilotClassHint === "enemy_ban_slot") banSlotNodes += 1;
      const kind = node.elementKind ?? "node";
      elementKinds[kind] = (elementKinds[kind] ?? 0) + 1;
    }
  }
  return {
    ready: true,
    path: layoutGraphPath,
    uiLibraryRoot: defaultUiRoot,
    createdAt: graph.createdAt ?? null,
    scope: graph.scope ?? null,
    engine: graph.engine ?? null,
    taxonomy: graph.taxonomy ?? null,
    bundlesScanned: Number(graph.inventory?.bundlesScanned ?? 0),
    bundlesWithNodes: Number(graph.inventory?.bundlesWithNodes ?? 0),
    totalNodes: Number(graph.inventory?.totalNodes ?? 0),
    pickSlotNodes,
    banSlotNodes,
    draftStateMarkers,
    screens,
    elementKinds,
    bytes: fileStat.size,
    extractorScript,
  };
}

export async function readUiLayoutGraphBundle(bundleName: string) {
  if (!(await exists(layoutGraphPath))) return null;
  const graph = JSON.parse(await readFile(layoutGraphPath, "utf8")) as {
    bundles?: Array<{ bundle: string; nodes: unknown[]; referenceResolution?: unknown }>;
  };
  const normalized = bundleName.replaceAll("\\", "/");
  return graph.bundles?.find((entry) => entry.bundle === normalized || entry.bundle.endsWith(`/${normalized}`)) ?? null;
}
