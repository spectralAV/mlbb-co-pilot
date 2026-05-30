import { assertRawFrameShape, normalizeRawPixelFormat, type RawPixelFormat, type RawVideoFrame } from "../vision/rawFrame.js";

export type NativeObsBridgeStatus = {
  connected: boolean;
  receivedFrames: number;
  receivedBytes: number;
  lastFrameAt: string | null;
  width: number;
  height: number;
  pixelFormat: string;
  source: string;
};

type NativeObsEncodedFrame = {
  kind: "encoded";
  buffer: Buffer;
  capturedAt: string;
  width: number;
  height: number;
  mimeType: "image/bmp";
};

type NativeObsRawFrame = RawVideoFrame & {
  kind: "raw";
  capturedAt: string;
  source: string;
};

type NativeObsFrame = NativeObsEncodedFrame | NativeObsRawFrame;

let latestFrame: NativeObsFrame | null = null;
let receivedFrames = 0;
let receivedBytes = 0;
let source = "obs-scrcpy-plugin";

function bmpDimensions(buffer: Buffer) {
  if (buffer.length < 26 || buffer.toString("ascii", 0, 2) !== "BM") {
    return { width: 0, height: 0 };
  }
  return {
    width: Math.abs(buffer.readInt32LE(18)),
    height: Math.abs(buffer.readInt32LE(22))
  };
}

export function ingestNativeObsFrame(buffer: Buffer, frameSource?: string) {
  const dimensions = bmpDimensions(buffer);
  const capturedAt = new Date().toISOString();
  receivedFrames += 1;
  receivedBytes += buffer.byteLength;
  source = frameSource || source;
  latestFrame = { kind: "encoded", buffer, capturedAt, ...dimensions, mimeType: "image/bmp" };
  return getNativeObsBridgeStatus();
}

export function ingestNativeObsRawFrame(
  buffer: Buffer,
  metadata: { width: number; height: number; pixelFormat: RawPixelFormat | string },
  frameSource?: string,
) {
  const pixelFormat = normalizeRawPixelFormat(metadata.pixelFormat);
  if (!pixelFormat) throw new Error(`Unsupported raw OBS frame pixel format: ${metadata.pixelFormat}`);
  const frame: NativeObsRawFrame = {
    kind: "raw",
    buffer,
    width: Number(metadata.width),
    height: Number(metadata.height),
    pixelFormat,
    capturedAt: new Date().toISOString(),
    source: frameSource || source,
  };
  assertRawFrameShape(frame);
  receivedFrames += 1;
  receivedBytes += buffer.byteLength;
  source = frame.source;
  latestFrame = frame;
  return getNativeObsBridgeStatus();
}

export function getLatestNativeObsFrame() {
  return latestFrame;
}

export function getNativeObsBridgeStatus(): NativeObsBridgeStatus {
  const lastFrameAt = latestFrame?.capturedAt ?? null;
  const connected = Boolean(lastFrameAt && Date.now() - Date.parse(lastFrameAt) < 2500);
  return {
    connected,
    receivedFrames,
    receivedBytes,
    lastFrameAt,
    width: latestFrame?.width ?? 0,
    height: latestFrame?.height ?? 0,
    pixelFormat: latestFrame?.kind === "raw" ? latestFrame.pixelFormat : latestFrame?.mimeType ?? "",
    source
  };
}
