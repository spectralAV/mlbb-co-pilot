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
const streamMagic = Buffer.from("NDIR");
const MAX_NDI_CLIENT_BUFFERED_BYTES = 8 * 1024 * 1024;

let ndiProcess: ChildProcessWithoutNullStreams | null = null;
let ndiSource = "";
let lastError = "";
let intentionalStop = false;
let cachedPng: { frameId: string; buffer: Buffer; width: number; height: number; capturedAt: string } | null = null;
type RawNdiFrame = { frameId: string; buffer: Buffer; width: number; height: number; capturedAt: string; fourCc: string; frameRateN: number; frameRateD: number };

let latestRawFrame: RawNdiFrame | null = null;
let streamRemainder = Buffer.alloc(0);
let receivedFrames = 0;
let receivedFrameTimes: number[] = [];
let frameWaiters: Array<{ after: string; resolve: (frame: RawNdiFrame | null) => void; timer: NodeJS.Timeout }> = [];
const rawFrameClients = new Set<any>();

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

function fourCcText(value: number) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer.toString("ascii").replace(/\0/g, "").trim();
}

function rememberRawFrame(width: number, height: number, payload: Buffer, frameRateN: number, frameRateD: number, fourCc: number) {
  receivedFrames += 1;
  const now = Date.now();
  receivedFrameTimes.push(now);
  while (receivedFrameTimes.length && now - receivedFrameTimes[0] > 1000) receivedFrameTimes.shift();
  latestRawFrame = {
    frameId: String(receivedFrames),
    buffer: payload,
    width,
    height,
    capturedAt: new Date(now).toISOString(),
    fourCc: fourCcText(fourCc),
    frameRateN,
    frameRateD,
  };
  cachedPng = null;
  if (lastError.includes("Source was not discovered")) lastError = "";
  resolveFrameWaiters();
  broadcastRawFrame(latestRawFrame);
}

function resolveFrameWaiters() {
  if (!latestRawFrame || !frameWaiters.length) return;
  const pending = frameWaiters;
  frameWaiters = [];
  for (const waiter of pending) {
    if (waiter.after && waiter.after === latestRawFrame.frameId) {
      frameWaiters.push(waiter);
      continue;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(latestRawFrame);
  }
}

function clearFrameWaiters() {
  const pending = frameWaiters;
  frameWaiters = [];
  for (const waiter of pending) {
    clearTimeout(waiter.timer);
    waiter.resolve(null);
  }
}

function broadcastRawFrame(frame: RawNdiFrame) {
  const meta = JSON.stringify({
    type: "ndi_frame",
    frameId: frame.frameId,
    width: frame.width,
    height: frame.height,
    capturedAt: frame.capturedAt,
    fourCc: frame.fourCc,
    frameRateN: frame.frameRateN,
    frameRateD: frame.frameRateD,
  });
  for (const client of rawFrameClients) {
    if (client.readyState !== 1) continue;
    if (typeof client.bufferedAmount === "number" && client.bufferedAmount > MAX_NDI_CLIENT_BUFFERED_BYTES) continue;
    client.send(meta);
    client.send(frame.buffer);
  }
}

function parseNdiStreamChunk(chunk: Buffer) {
  const nextChunk = Buffer.from(chunk);
  streamRemainder = streamRemainder.length ? Buffer.concat([streamRemainder, nextChunk]) : nextChunk;
  while (streamRemainder.length >= 32) {
    if (!streamRemainder.subarray(0, 4).equals(streamMagic)) {
      const nextMagic = streamRemainder.indexOf(streamMagic, 1);
      streamRemainder = nextMagic >= 0 ? streamRemainder.subarray(nextMagic) : Buffer.alloc(0);
      continue;
    }
    const width = streamRemainder.readInt32LE(4);
    const height = streamRemainder.readInt32LE(8);
    const payloadLength = streamRemainder.readInt32LE(12);
    const frameRateN = streamRemainder.readInt32LE(16);
    const frameRateD = streamRemainder.readInt32LE(20);
    const fourCc = streamRemainder.readUInt32LE(24);
    if (width <= 0 || height <= 0 || payloadLength !== width * height * 4 || payloadLength > 64 * 1024 * 1024) {
      lastError = `Invalid direct NDI frame header: ${width}x${height}, ${payloadLength} bytes.`;
      const nextMagic = streamRemainder.indexOf(streamMagic, 4);
      streamRemainder = nextMagic >= 0 ? streamRemainder.subarray(nextMagic) : Buffer.alloc(0);
      continue;
    }
    if (streamRemainder.length < 32 + payloadLength) break;
    const payload = Buffer.from(streamRemainder.subarray(32, 32 + payloadLength));
    rememberRawFrame(width, height, payload, frameRateN, frameRateD, fourCc);
    streamRemainder = streamRemainder.subarray(32 + payloadLength);
  }
}

function parseNdiStderr(chunk: Buffer) {
  const text = String(chunk);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const message = JSON.parse(trimmed);
      if (message?.error) lastError = String(message.error).slice(0, 1000);
      if (message?.warning && !latestRawFrame) lastError = String(message.warning).slice(0, 1000);
    } catch {
      lastError = trimmed.slice(0, 1000);
    }
  }
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
  streamRemainder = Buffer.alloc(0);
  receivedFrameTimes = [];
  clearFrameWaiters();
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
  latestRawFrame = null;
  streamRemainder = Buffer.alloc(0);
  receivedFrames = 0;
  receivedFrameTimes = [];
  lastError = "";
  intentionalStop = false;
  ndiSource = sourceName;
  const args = [
    helper,
    "stream",
    "--runtimeDll", status.runtimeDll,
    "--sourceName", sourceName,
    "--timeoutMs", "6500",
    "--maxFps", String(Math.max(1, Math.min(120, Number(options.maxFps ?? 30)))),
  ];
  if (options.sourceUrl) args.push("--sourceUrl", options.sourceUrl);
  ndiProcess = spawn("dotnet", args, { cwd: ROOT, windowsHide: true });
  ndiProcess.stdout.on("data", parseNdiStreamChunk);
  ndiProcess.stderr.on("data", parseNdiStderr);
  ndiProcess.on("exit", (code, signal) => {
    if (!intentionalStop && (code || signal)) lastError ||= `NDI direct receiver exited (${code ?? signal}).`;
    ndiProcess = null;
  });
  return { ok: true, status: getNdiDirectStatus(), sourceName };
}

export function getNdiDirectStatus() {
  const now = Date.now();
  while (receivedFrameTimes.length && now - receivedFrameTimes[0] > 1000) receivedFrameTimes.shift();
  const status = readJson(statusPath);
  const frameStat = fs.existsSync(framePath) ? fs.statSync(framePath) : null;
  const frameDimensions = !latestRawFrame && frameStat ? bmpDimensions(fs.readFileSync(framePath)) : { width: 0, height: 0 };
  const lastFrameAt = latestRawFrame?.capturedAt ?? status?.lastFrameAt ?? frameStat?.mtime.toISOString() ?? null;
  const latestFrameMs = latestRawFrame ? Date.parse(latestRawFrame.capturedAt) : 0;
  const frameFresh = Boolean(latestRawFrame ? Date.now() - latestFrameMs < 2500 : frameStat && Date.now() - frameStat.mtimeMs < 2500);
  const hasFrames = receivedFrames > 0 || Number(status?.frames ?? 0) > 0 || Boolean(frameStat);
  const running = Boolean(ndiProcess && !ndiProcess.killed);
  return {
    ok: true,
    running,
    connected: Boolean(running && ((status?.connected && hasFrames) || frameFresh)),
    source: status?.source ?? ndiSource,
    width: latestRawFrame?.width ?? status?.width ?? status?.Width ?? frameDimensions.width,
    height: latestRawFrame?.height ?? status?.height ?? status?.Height ?? frameDimensions.height,
    aspect: latestRawFrame ? latestRawFrame.width / latestRawFrame.height : status?.aspect ?? status?.Aspect ?? 0,
    frames: receivedFrames || status?.frames || 0,
    receiverFps: receivedFrameTimes.length,
    frameRate: latestRawFrame?.frameRateD ? latestRawFrame.frameRateN / latestRawFrame.frameRateD : null,
    fourCc: latestRawFrame?.fourCc ?? status?.fourCcText ?? status?.FourCcText ?? "",
    transport: running ? "stdout-rgba" : "idle",
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
  if (latestRawFrame) {
    if (cachedPng?.frameId === latestRawFrame.frameId) return cachedPng;
    const buffer = await sharp(latestRawFrame.buffer, { raw: { width: latestRawFrame.width, height: latestRawFrame.height, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer();
    cachedPng = {
      frameId: latestRawFrame.frameId,
      buffer,
      width: latestRawFrame.width,
      height: latestRawFrame.height,
      capturedAt: latestRawFrame.capturedAt,
    };
    return cachedPng;
  }
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

export function getLatestNdiDirectRawFrame() {
  return latestRawFrame;
}

export function waitForNextNdiDirectRawFrame(after = "", timeoutMs = 120) {
  if (latestRawFrame && (!after || latestRawFrame.frameId !== after)) return Promise.resolve(latestRawFrame);
  return new Promise<RawNdiFrame | null>((resolve) => {
    const waiter = {
      after,
      resolve,
      timer: setTimeout(() => {
        frameWaiters = frameWaiters.filter((item) => item !== waiter);
        resolve(null);
      }, Math.max(16, timeoutMs)),
    };
    frameWaiters.push(waiter);
  });
}

export function attachNdiDirectRawClient(socket: any) {
  rawFrameClients.add(socket);
  socket.send(JSON.stringify({ type: "ndi_status", status: getNdiDirectStatus() }));
  if (latestRawFrame) broadcastRawFrame(latestRawFrame);
  socket.on("close", () => rawFrameClients.delete(socket));
}
