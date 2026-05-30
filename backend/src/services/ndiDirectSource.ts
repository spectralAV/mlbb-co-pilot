import { spawn, type ChildProcessWithoutNullStreams, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { getNdiToolsStatus } from "./ndiTools.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd(), "..");
const helperProject = path.join(ROOT, "backend", "tools", "ndi-direct", "NdiDirect.csproj");
const helperDll = path.join(ROOT, "backend", "tools", "ndi-direct", "bin", "Release", "net8.0", "NdiDirect.dll");
const captureDir = path.join(ROOT, "data", "capture");
const framePath = path.join(captureDir, "ndi-direct-frame.bmp");
const statusPath = path.join(captureDir, "ndi-direct-status.json");

let ndiProcess: ChildProcessWithoutNullStreams | null = null;
let ndiSource = "";
let lastError = "";
let intentionalStop = false;
let cachedPng: { frameId: string; buffer: Buffer; width: number; height: number; capturedAt: string } | null = null;

async function ensureHelper() {
  if (fs.existsSync(helperDll)) return helperDll;
  await execFileAsync("dotnet", ["build", helperProject, "-c", "Release"], {
    cwd: ROOT,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return helperDll;
}

function readJson(file: string) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function bmpDimensions(buffer: Buffer) {
  if (buffer.length < 26 || buffer.toString("ascii", 0, 2) !== "BM") return { width: 0, height: 0 };
  return {
    width: Math.abs(buffer.readInt32LE(18)),
    height: Math.abs(buffer.readInt32LE(22)),
  };
}

export async function listNdiDirectSources() {
  const status = await getNdiToolsStatus();
  if (!status.runtimeDll) return { ok: false, sources: [], status, error: "NDI runtime DLL was not found." };
  const helper = await ensureHelper();
  const { stdout } = await execFileAsync("dotnet", [helper, "list", "--runtimeDll", status.runtimeDll, "--timeoutMs", "4500"], {
    cwd: ROOT,
    windowsHide: true,
    timeout: 8000,
    maxBuffer: 1024 * 1024,
  });
  return { ...JSON.parse(stdout), status };
}

export function stopNdiDirectCapture() {
  intentionalStop = true;
  if (ndiProcess && !ndiProcess.killed) ndiProcess.kill();
  ndiProcess = null;
  lastError = "";
  return getNdiDirectStatus();
}

export async function startNdiDirectCapture(options: { sourceName?: string; sourceUrl?: string; maxFps?: number }) {
  const sourceName = String(options.sourceName ?? "").trim();
  if (!sourceName) return { ok: false, error: "Select an NDI source first.", status: getNdiDirectStatus() };
  const status = await getNdiToolsStatus();
  if (!status.runtimeDll) return { ok: false, error: "NDI runtime DLL was not found.", status };
  const helper = await ensureHelper();
  fs.mkdirSync(captureDir, { recursive: true });
  stopNdiDirectCapture();
  fs.rmSync(framePath, { force: true });
  fs.rmSync(statusPath, { force: true });
  cachedPng = null;
  lastError = "";
  intentionalStop = false;
  ndiSource = sourceName;
  const args = [
    helper,
    "capture",
    "--runtimeDll", status.runtimeDll,
    "--sourceName", sourceName,
    "--output", framePath,
    "--status", statusPath,
    "--timeoutMs", "3000",
    "--maxFps", String(Math.max(1, Math.min(60, Number(options.maxFps ?? 30)))),
  ];
  if (options.sourceUrl) args.push("--sourceUrl", options.sourceUrl);
  ndiProcess = spawn("dotnet", args, { cwd: ROOT, windowsHide: true });
  ndiProcess.stderr.on("data", (chunk) => { lastError = String(chunk).slice(0, 1000); });
  ndiProcess.on("exit", (code, signal) => {
    if (!intentionalStop && (code || signal)) lastError ||= `NDI direct receiver exited (${code ?? signal}).`;
    ndiProcess = null;
  });
  return { ok: true, status: getNdiDirectStatus(), sourceName };
}

export function getNdiDirectStatus() {
  const status = readJson(statusPath);
  const frameStat = fs.existsSync(framePath) ? fs.statSync(framePath) : null;
  const frameDimensions = frameStat ? bmpDimensions(fs.readFileSync(framePath)) : { width: 0, height: 0 };
  const lastFrameAt = status?.lastFrameAt ?? frameStat?.mtime.toISOString() ?? null;
  const frameFresh = Boolean(frameStat && Date.now() - frameStat.mtimeMs < 2500);
  const hasFrames = Number(status?.frames ?? 0) > 0 || Boolean(frameStat);
  const running = Boolean(ndiProcess && !ndiProcess.killed);
  return {
    ok: true,
    running,
    connected: Boolean(running && ((status?.connected && hasFrames) || frameFresh)),
    source: status?.source ?? ndiSource,
    width: status?.width || status?.Width || frameDimensions.width,
    height: status?.height || status?.Height || frameDimensions.height,
    aspect: status?.aspect ?? status?.Aspect ?? 0,
    frames: status?.frames ?? 0,
    lastFrameAt,
    error: lastError || status?.error || "",
    framePath,
  };
}

function decodeBgrxBmp(buffer: Buffer) {
  if (buffer.length < 54 || buffer.toString("ascii", 0, 2) !== "BM") throw new Error("Direct NDI frame is not a BMP.");
  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const bitsPerPixel = buffer.readUInt16LE(28);
  if (width <= 0 || height <= 0 || bitsPerPixel !== 32) throw new Error(`Unsupported direct NDI BMP format: ${width}x${height} ${bitsPerPixel}bpp.`);
  const sourceStride = width * 4;
  const rgba = Buffer.allocUnsafe(sourceStride * height);
  for (let y = 0; y < height; y++) {
    const sourceY = topDown ? y : height - y - 1;
    const sourceRow = pixelOffset + sourceY * sourceStride;
    const targetRow = y * sourceStride;
    for (let x = 0; x < width; x++) {
      const sourceIndex = sourceRow + x * 4;
      const targetIndex = targetRow + x * 4;
      rgba[targetIndex] = buffer[sourceIndex + 2];
      rgba[targetIndex + 1] = buffer[sourceIndex + 1];
      rgba[targetIndex + 2] = buffer[sourceIndex];
      rgba[targetIndex + 3] = 255;
    }
  }
  return { rgba, width, height };
}

export async function getLatestNdiDirectFrame() {
  if (!fs.existsSync(framePath)) return null;
  const status = readJson(statusPath);
  const stat = fs.statSync(framePath);
  const frameId = String(status?.frames ?? stat.mtimeMs);
  const capturedAt = status?.lastFrameAt ?? stat.mtime.toISOString();
  if (cachedPng?.frameId === frameId) return cachedPng;
  const bmp = fs.readFileSync(framePath);
  const frame = decodeBgrxBmp(bmp);
  const buffer = await sharp(frame.rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer();
  cachedPng = {
    frameId,
    buffer,
    width: frame.width,
    height: frame.height,
    capturedAt,
  };
  return {
    buffer,
    capturedAt,
    frameId,
    width: frame.width,
    height: frame.height,
  };
}
