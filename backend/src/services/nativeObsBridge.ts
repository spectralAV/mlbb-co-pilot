export type NativeObsBridgeStatus = {
  connected: boolean;
  receivedFrames: number;
  receivedBytes: number;
  lastFrameAt: string | null;
  width: number;
  height: number;
  source: string;
};

type NativeObsFrame = {
  buffer: Buffer;
  capturedAt: string;
  width: number;
  height: number;
};

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
  latestFrame = { buffer, capturedAt, ...dimensions };
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
    source
  };
}
