import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { resolveAdb } from "./adbFrameSource.js";

const ROOT = path.resolve(process.cwd(), "..");
const DEVICE_SERVER_PATH = "/data/local/tmp/mlbb-copilot-scrcpy-server.jar";
const SCRCPY_PORT = 27183;
const MAX_CLIENT_BUFFERED_BYTES = 192 * 1024;
type ScrcpyVideoCodec = "h264" | "h265" | "av1";

let scrcpyProcess: ChildProcessWithoutNullStreams | null = null;
let h264Shell: ChildProcessWithoutNullStreams | null = null;
let h264Socket: net.Socket | null = null;
let startedAt: string | null = null;
let lastExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | null = null;
let lastError = "";
let lastArgs: string[] = [];
let h264Started = false;
let h264Buffer = Buffer.alloc(0);
let codecMetaRead = false;
let h264RawStream = false;
let h264Stats = { frames: 0, bytes: 0, width: 0, height: 0, codec: "", lastFrameAt: null as string | null };
const h264Clients = new Set<any>();
const h264ClientState = new Map<any, { needsKeyframe: boolean }>();

function candidateScrcpyPaths() {
  return [
    process.env.SCRCPY_PATH,
    path.join(ROOT, "..", "Downloads", "scrcpy-win64-v4.0", "scrcpy.exe"),
    path.join(process.env.USERPROFILE ?? "", "Downloads", "scrcpy-win64-v4.0", "scrcpy.exe"),
    "scrcpy"
  ].filter(Boolean) as string[];
}

function candidateScrcpyServerPaths() {
  return [
    process.env.SCRCPY_SERVER_PATH,
    path.join(ROOT, "..", "Downloads", "scrcpy-win64-v4.0", "scrcpy-server"),
    path.join(process.env.USERPROFILE ?? "", "Downloads", "scrcpy-win64-v4.0", "scrcpy-server")
  ].filter(Boolean) as string[];
}

export function resolveScrcpy() {
  for (const candidate of candidateScrcpyPaths()) {
    if (candidate === "scrcpy") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "scrcpy";
}

function resolveScrcpyServer() {
  for (const candidate of candidateScrcpyServerPaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("scrcpy-server was not found. Set SCRCPY_SERVER_PATH or install scrcpy-win64-v4.0 in Downloads.");
}

export function getScrcpyStatus() {
  return {
    ok: Boolean((scrcpyProcess && !scrcpyProcess.killed) || h264Started),
    mode: h264Started ? `scrcpy-${h264Stats.codec || "video"}-webcodecs` : "scrcpy-native",
    scrcpy: resolveScrcpy(),
    pid: h264Shell?.pid ?? scrcpyProcess?.pid ?? null,
    startedAt,
    lastExit,
    lastError,
    args: lastArgs,
    clients: h264Clients.size,
    h264: h264Stats,
    message: h264Started ? "scrcpy H.264 stream is running." : scrcpyProcess && !scrcpyProcess.killed ? "scrcpy native mirror is running." : "scrcpy native mirror is stopped."
  };
}

export function startScrcpy(options: any = {}) {
  const requestedCodec = normalizeVideoCodec(options.videoCodec ?? options.decoder);
  if ((options.decoder === "h265" || options.decoder === "av1" || requestedCodec !== "h264") && !options.allowExperimentalCodec) {
    lastError = `${requestedCodec.toUpperCase()} scrcpy streaming is not wired into the low-latency browser decoder yet. Use H.264 for live capture.`;
    return { ...getScrcpyStatus(), ok: false, message: lastError };
  }
  if (options.decoder === "h264" || options.directH264) return startScrcpyH264({ ...options, decoder: "h264", videoCodec: "h264", rawStream: true });
  if (scrcpyProcess && !scrcpyProcess.killed) return getScrcpyStatus();
  const scrcpy = resolveScrcpy();
  const background = options.background !== false;
  const videoCodec = normalizeVideoCodec(options.videoCodec);
  const args = [
    `--video-codec=${videoCodec}`,
    `--video-bit-rate=${String(options.videoBitRate ?? "16M")}`,
    `--max-fps=${String(options.maxFps ?? 60)}`,
    "--no-audio",
    "--stay-awake"
  ];
  if (background) {
    args.push("--no-window");
  } else {
    args.push("--window-title=MLBB Co-Pilot scrcpy", "--render-driver=direct3d");
    if (options.windowWidth) args.push(`--window-width=${String(options.windowWidth)}`);
    if (options.windowHeight) args.push(`--window-height=${String(options.windowHeight)}`);
  }
  if (options.turnScreenOff) args.push("--turn-screen-off");
  lastError = "";
  lastExit = null;
  lastArgs = args;
  scrcpyProcess = spawn(scrcpy, args, { windowsHide: background });
  startedAt = new Date().toISOString();
  scrcpyProcess.stderr.on("data", (data) => {
    lastError = String(data).trim().slice(-2000);
  });
  scrcpyProcess.on("error", (error) => {
    lastError = error.message;
  });
  scrcpyProcess.on("exit", (code, signal) => {
    lastExit = { code, signal, at: new Date().toISOString() };
    scrcpyProcess = null;
    startedAt = null;
  });
  return getScrcpyStatus();
}

export function stopScrcpy() {
  if (scrcpyProcess && !scrcpyProcess.killed) scrcpyProcess.kill();
  scrcpyProcess = null;
  stopScrcpyH264();
  startedAt = null;
  return getScrcpyStatus();
}

export function attachScrcpyH264Client(socket: any) {
  h264Clients.add(socket);
  h264ClientState.set(socket, { needsKeyframe: true });
  socket.send(JSON.stringify({ type: "scrcpy_status", status: getScrcpyStatus() }));
  socket.on("close", () => {
    h264Clients.delete(socket);
    h264ClientState.delete(socket);
  });
}

function broadcastJson(message: unknown) {
  const payload = JSON.stringify(message);
  for (const client of h264Clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastBinary(payload: Buffer) {
  for (const client of h264Clients) {
    if (client.readyState !== 1) continue;
    client.send(payload);
  }
}

function broadcastH264Frame(meta: { type: "scrcpy_frame"; config: boolean; key: boolean; ptsUs: number; size: number }, payload: Buffer) {
  const metaPayload = JSON.stringify(meta);
  for (const client of h264Clients) {
    if (client.readyState !== 1) continue;
    const state = h264ClientState.get(client) ?? { needsKeyframe: true };
    h264ClientState.set(client, state);

    if (!meta.config && state.needsKeyframe && !meta.key) continue;
    if (!meta.config && typeof client.bufferedAmount === "number" && client.bufferedAmount > MAX_CLIENT_BUFFERED_BYTES) {
      state.needsKeyframe = true;
      continue;
    }

    client.send(metaPayload);
    client.send(payload);
    if (meta.key) state.needsKeyframe = false;
  }
}

function stopScrcpyH264() {
  h264Started = false;
  h264Buffer = Buffer.alloc(0);
  codecMetaRead = false;
  h264RawStream = false;
  h264Stats = { frames: 0, bytes: 0, width: 0, height: 0, codec: "", lastFrameAt: null };
  h264Socket?.destroy();
  h264Socket = null;
  if (h264Shell && !h264Shell.killed) h264Shell.kill();
  h264Shell = null;
  void resolveAdb().then((adb) => {
    spawn(adb, ["forward", "--remove", `tcp:${SCRCPY_PORT}`], { windowsHide: true }).on("error", () => {});
  }).catch(() => {});
}

async function startScrcpyH264(options: any = {}) {
  if (h264Started) return getScrcpyStatus();
  if (scrcpyProcess && !scrcpyProcess.killed) scrcpyProcess.kill();
  scrcpyProcess = null;
  stopScrcpyH264();
  const adb = await resolveAdb();
  const server = resolveScrcpyServer();
  const bitRate = String(options.videoBitRate ?? 16000000).replace(/[^0-9]/g, "") || "16000000";
  const maxFps = String(options.maxFps ?? 60);
  const videoCodec = normalizeVideoCodec(options.videoCodec ?? options.decoder);
  const encoder = typeof options.videoEncoder === "string" ? options.videoEncoder : defaultVideoEncoder(videoCodec);
  const rawStream = options.rawStream ?? videoCodec === "h264";
  lastError = "";
  lastExit = null;

  await runAdb(adb, ["push", server, DEVICE_SERVER_PATH]);
  await runAdb(adb, ["forward", `tcp:${SCRCPY_PORT}`, "localabstract:scrcpy"]);

  const serverArgs = [
    "shell",
    `CLASSPATH=${DEVICE_SERVER_PATH}`,
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    "4.0",
    "tunnel_forward=true",
    "audio=false",
    "control=false",
    "cleanup=false",
    `raw_stream=${rawStream ? "true" : "false"}`,
    `video_codec=${videoCodec}`,
    `video_bit_rate=${bitRate}`,
    `max_fps=${maxFps}`
  ];
  if (encoder) serverArgs.push(`video_encoder=${encoder}`);
  lastArgs = serverArgs;
  h264Stats.codec = videoCodec;
  h264RawStream = Boolean(rawStream);
  broadcastJson({ type: "scrcpy_log", message: `Starting scrcpy ${videoCodec.toUpperCase()} stream, raw=${rawStream}, max_fps=${maxFps}, bitrate=${bitRate}.` });
  h264Shell = spawn(adb, serverArgs, { windowsHide: true });
  startedAt = new Date().toISOString();
  h264Shell.stdout.on("data", (data) => {
    const text = String(data).trim();
    if (text) {
      lastError = text.slice(-4000);
      broadcastJson({ type: "scrcpy_log", message: lastError });
    }
  });
  h264Shell.stderr.on("data", (data) => {
    lastError = String(data).trim().slice(-4000);
    broadcastJson({ type: "scrcpy_log", message: lastError });
  });
  h264Shell.on("error", (error) => {
    lastError = error.message;
    broadcastJson({ type: "scrcpy_error", message: error.message });
  });
  h264Shell.on("exit", (code, signal) => {
    lastExit = { code, signal, at: new Date().toISOString() };
    h264Shell = null;
    h264Started = false;
    startedAt = null;
    broadcastJson({ type: "scrcpy_exit", code, signal });
  });

  await new Promise((resolve) => setTimeout(resolve, Number(options.connectDelayMs ?? 1200)));
  await connectH264Socket();
  h264Started = true;
  return getScrcpyStatus();
}

function runAdb(adb: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(adb, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += String(data); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `adb ${args.join(" ")} failed with ${code}`)));
  });
}

async function connectH264Socket() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      h264Socket = await new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect(SCRCPY_PORT, "127.0.0.1");
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error("scrcpy socket connect timeout"));
        }, 500);
        socket.once("connect", () => {
          clearTimeout(timeout);
          resolve(socket);
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      h264Socket.on("data", parseScrcpyBytes);
      h264Socket.on("close", () => {
        h264Started = false;
        broadcastJson({ type: "scrcpy_socket_closed" });
      });
      h264Socket.on("error", (error) => {
        lastError = error.message;
        broadcastJson({ type: "scrcpy_error", message: error.message });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Could not connect to scrcpy H.264 socket.");
}

function parseScrcpyBytes(chunk: Buffer) {
  if (h264RawStream) {
    h264Stats.bytes += chunk.byteLength;
    h264Stats.lastFrameAt = new Date().toISOString();
    if (!codecMetaRead) {
      codecMetaRead = true;
      h264Stats.codec ||= "h264";
      broadcastJson({ type: "scrcpy_stream_meta", codec: h264Stats.codec, raw: true });
    }
    broadcastBinary(chunk);
    return;
  }
  h264Buffer = Buffer.concat([h264Buffer, chunk]);
  if (!codecMetaRead && h264Buffer.length >= 4) {
    const codec = h264Buffer.subarray(0, 4).toString("ascii").replace(/\0/g, "");
    h264Stats.codec = codec;
    codecMetaRead = true;
    h264Buffer = h264Buffer.subarray(4);
    broadcastJson({ type: "scrcpy_stream_meta", codec });
  }

  while (h264Buffer.length >= 12) {
    if (h264Buffer[0] & 0x80) {
      const width = h264Buffer.readUInt32BE(4);
      const height = h264Buffer.readUInt32BE(8);
      h264Buffer = h264Buffer.subarray(12);
      h264Stats.width = width;
      h264Stats.height = height;
      broadcastJson({ type: "scrcpy_stream_meta", codec: h264Stats.codec, width, height });
      continue;
    }
    const ptsFlags = h264Buffer.readBigUInt64BE(0);
    const size = h264Buffer.readUInt32BE(8);
    if (h264Buffer.length < 12 + size) return;
    const config = Boolean(ptsFlags & (1n << 62n));
    const key = Boolean(ptsFlags & (1n << 61n));
    const ptsUs = Number(ptsFlags & ((1n << 61n) - 1n));
    const payload = h264Buffer.subarray(12, 12 + size);
    h264Buffer = h264Buffer.subarray(12 + size);
    h264Stats.frames += 1;
    h264Stats.bytes += size;
    h264Stats.lastFrameAt = new Date().toISOString();
    broadcastH264Frame({ type: "scrcpy_frame", config, key, ptsUs, size }, payload);
  }
}

function normalizeVideoCodec(value: unknown): ScrcpyVideoCodec {
  return value === "h265" || value === "av1" ? value : "h264";
}

function defaultVideoEncoder(codec: ScrcpyVideoCodec) {
  void codec;
  return undefined;
}
