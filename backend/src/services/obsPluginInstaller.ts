import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const ROOT = path.resolve(process.cwd(), "..");
const pluginId = "obs-scrcpy-source";
const bundledRoot = path.join(ROOT, "modules", pluginId);
const bundledBin = path.join(bundledRoot, "bin", "64bit");
const bundledData = path.join(bundledRoot, "data");
const pluginDll = `${pluginId}.dll`;
const runtimeDlls = ["avcodec-62.dll", "avutil-60.dll", "swresample-6.dll"];
const execFileAsync = promisify(execFile);

export type ObsScrcpyPluginStatus = {
  ok: boolean;
  obsInstalled: boolean;
  obsRoot: string | null;
  obsExecutable: string | null;
  bundled: boolean;
  installed: boolean;
  upToDate: boolean;
  pluginRoot: string | null;
  pluginDll: string | null;
  dataDir: string | null;
  obsRunning: boolean;
  programFilesWritable: boolean;
  installedFiles: string[];
  missingFiles: string[];
  updatedFiles: string[];
  error: string;
  action: string;
};

async function exists(target: string) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(target: string) {
  const buffer = await fs.readFile(target);
  return createHash("sha256").update(buffer).digest("hex");
}

async function sameFile(left: string, right: string) {
  if (!await exists(left) || !await exists(right)) return false;
  const [leftHash, rightHash] = await Promise.all([hashFile(left), hashFile(right)]);
  return leftHash === rightHash;
}

async function canWriteDirectory(target: string | null) {
  if (!target) return false;
  try {
    await fs.access(target, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function isObsRunning() {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq obs64.exe", "/NH"], { windowsHide: true });
    return stdout.toLowerCase().includes("obs64.exe");
  } catch {
    return false;
  }
}

function obsCandidates() {
  const candidates = [
    process.env.OBS_STUDIO_ROOT,
    process.env.OBS_ROOT,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "obs-studio") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"]!, "obs-studio") : "",
    "C:\\Program Files\\obs-studio",
  ].filter(Boolean) as string[];
  return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

async function findObsRoot() {
  for (const candidate of obsCandidates()) {
    const executable = path.join(candidate, "bin", "64bit", "obs64.exe");
    if (await exists(executable)) return { root: candidate, executable };
  }
  return { root: null, executable: null };
}

function installPaths(obsRoot: string | null) {
  if (!obsRoot) return null;
  return {
    pluginRoot: path.join(obsRoot, "obs-plugins"),
    binRoot: path.join(obsRoot, "obs-plugins", "64bit"),
    dataDir: path.join(obsRoot, "data", "obs-plugins", pluginId),
  };
}

function legacyUserInstallRoot() {
  if (!process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, "obs-studio", "plugins", pluginId);
}

async function listInstallFiles(paths: ReturnType<typeof installPaths>) {
  if (!paths) return [];
  const files = [
    path.join(paths.binRoot, pluginDll),
    ...runtimeDlls.map((file) => path.join(paths.binRoot, file)),
    path.join(paths.dataDir, "locale", "en-US.ini"),
  ];
  const present: string[] = [];
  for (const file of files) if (await exists(file)) present.push(file);
  return present;
}

async function copyFileEnsured(source: string, destination: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyDir(source: string, destination: string) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
}

async function removeLegacyUserInstall() {
  const root = legacyUserInstallRoot();
  if (!root) return;
  await fs.rm(root, { recursive: true, force: true });
}

async function inspectInstall(obsRoot: string | null, obsExecutable: string | null, error = ""): Promise<ObsScrcpyPluginStatus> {
  const paths = installPaths(obsRoot);
  const bundled = await exists(path.join(bundledBin, pluginDll));
  const [obsRunning, programFilesWritable] = await Promise.all([
    isObsRunning(),
    canWriteDirectory(paths?.binRoot ?? null),
  ]);
  const expected = paths
    ? [
      [path.join(bundledBin, pluginDll), path.join(paths.binRoot, pluginDll)],
      ...runtimeDlls.map((file) => [path.join(bundledBin, file), path.join(paths.binRoot, file)] as [string, string]),
      [path.join(bundledData, "locale", "en-US.ini"), path.join(paths.dataDir, "locale", "en-US.ini")] as [string, string],
    ]
    : [];
  const missingFiles: string[] = [];
  const updatedFiles: string[] = [];
  for (const [source, destination] of expected) {
    if (!await exists(destination)) missingFiles.push(destination);
    else if (!await sameFile(source, destination)) updatedFiles.push(destination);
  }
  const installedFiles = await listInstallFiles(paths);
  const obsInstalled = Boolean(obsRoot && obsExecutable);
  const installed = Boolean(obsInstalled && bundled && paths && missingFiles.length === 0);
  const upToDate = Boolean(installed && updatedFiles.length === 0);
  const installAction = (() => {
    if (!obsInstalled) return "Install OBS Studio to enable the native scrcpy source plugin.";
    if (!bundled) return "Bundled OBS plugin files are missing from modules/obs-scrcpy-source.";
    if (obsRunning) return "Close OBS Studio, then retry plugin install so the loaded DLL can be replaced.";
    if (!programFilesWritable) return "Run MLBB Co-Pilot as administrator to update OBS Studio under Program Files.";
    if (error) return "Plugin install failed; check the installer error and retry.";
    if (upToDate) return "OBS plugin is installed. Restart OBS after updates before using the source.";
    return "Plugin will be installed into the OBS Studio program plugin folder.";
  })();
  return {
    ok: Boolean(obsInstalled && bundled && upToDate && !error),
    obsInstalled,
    obsRoot,
    obsExecutable,
    bundled,
    installed,
    upToDate,
    pluginRoot: paths?.pluginRoot ?? null,
    pluginDll: paths ? path.join(paths.binRoot, pluginDll) : null,
    dataDir: paths?.dataDir ?? null,
    obsRunning,
    programFilesWritable,
    installedFiles,
    missingFiles,
    updatedFiles,
    error,
    action: installAction,
  };
}

export async function getObsScrcpyPluginStatus() {
  const obs = await findObsRoot();
  return inspectInstall(obs.root, obs.executable);
}

export async function installObsScrcpyPlugin() {
  const obs = await findObsRoot();
  if (!obs.root || !obs.executable) return inspectInstall(obs.root, obs.executable);
  const paths = installPaths(obs.root);
  if (!paths) return inspectInstall(obs.root, obs.executable, "OBS Studio install path is unavailable.");
  if (!await exists(path.join(bundledBin, pluginDll))) return inspectInstall(obs.root, obs.executable);

  try {
    await copyFileEnsured(path.join(bundledBin, pluginDll), path.join(paths.binRoot, pluginDll));
    for (const file of runtimeDlls) {
      await copyFileEnsured(path.join(bundledBin, file), path.join(paths.binRoot, file));
    }
    await copyDir(bundledData, paths.dataDir);
    try {
      await removeLegacyUserInstall();
    } catch {
      // The Program Files install is canonical; a locked old per-user copy should not fail this update.
    }
    return inspectInstall(obs.root, obs.executable);
  } catch (error) {
    return inspectInstall(obs.root, obs.executable, error instanceof Error ? error.message : "OBS plugin install failed.");
  }
}

export async function ensureObsScrcpyPluginInstalled() {
  const status = await getObsScrcpyPluginStatus();
  if (!status.obsInstalled || !status.bundled || status.upToDate) return status;
  return installObsScrcpyPlugin();
}
