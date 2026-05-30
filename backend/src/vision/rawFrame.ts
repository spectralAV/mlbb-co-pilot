import sharp from "sharp";

export const rawPixelFormats = ["BGRA", "BGRX", "RGBA", "RGBX", "BGR", "RGB"] as const;
export type RawPixelFormat = typeof rawPixelFormats[number];

export type RawVideoFrame = {
  buffer: Buffer;
  width: number;
  height: number;
  pixelFormat: RawPixelFormat;
  capturedAt?: string;
  frameId?: string;
};

export type VisionFrameInput = Buffer | RawVideoFrame;

export function normalizeRawPixelFormat(value: unknown): RawPixelFormat | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return rawPixelFormats.includes(normalized as RawPixelFormat)
    ? normalized as RawPixelFormat
    : null;
}

export function isRawVideoFrame(value: unknown): value is RawVideoFrame {
  const frame = value as RawVideoFrame;
  return Boolean(
    frame &&
      Buffer.isBuffer(frame.buffer) &&
      Number.isInteger(frame.width) &&
      frame.width > 0 &&
      Number.isInteger(frame.height) &&
      frame.height > 0 &&
      normalizeRawPixelFormat(frame.pixelFormat),
  );
}

export function rawFrameBytesPerPixel(pixelFormat: RawPixelFormat) {
  return pixelFormat.length === 4 ? 4 : 3;
}

export function assertRawFrameShape(frame: RawVideoFrame) {
  const expected = frame.width * frame.height * rawFrameBytesPerPixel(frame.pixelFormat);
  if (frame.buffer.byteLength !== expected) {
    throw new Error(`Raw ${frame.pixelFormat} frame has ${frame.buffer.byteLength} bytes, expected ${expected}.`);
  }
}

export async function frameDimensions(input: VisionFrameInput) {
  if (isRawVideoFrame(input)) return { width: input.width, height: input.height };
  const metadata = await sharp(input).metadata();
  return { width: metadata.width ?? 0, height: metadata.height ?? 0 };
}

export function rawFrameToRgbaBuffer(frame: RawVideoFrame) {
  assertRawFrameShape(frame);
  if (frame.pixelFormat === "RGBA") return frame.buffer;
  const channels = rawFrameBytesPerPixel(frame.pixelFormat);
  const rgba = Buffer.allocUnsafe(frame.width * frame.height * 4);
  for (let source = 0, target = 0; source < frame.buffer.length; source += channels, target += 4) {
    switch (frame.pixelFormat) {
    case "BGRA":
    case "BGRX":
      rgba[target] = frame.buffer[source + 2];
      rgba[target + 1] = frame.buffer[source + 1];
      rgba[target + 2] = frame.buffer[source];
      rgba[target + 3] = frame.pixelFormat === "BGRA" ? frame.buffer[source + 3] : 255;
      break;
    case "BGR":
      rgba[target] = frame.buffer[source + 2];
      rgba[target + 1] = frame.buffer[source + 1];
      rgba[target + 2] = frame.buffer[source];
      rgba[target + 3] = 255;
      break;
    case "RGB":
      rgba[target] = frame.buffer[source];
      rgba[target + 1] = frame.buffer[source + 1];
      rgba[target + 2] = frame.buffer[source + 2];
      rgba[target + 3] = 255;
      break;
    case "RGBX":
      rgba[target] = frame.buffer[source];
      rgba[target + 1] = frame.buffer[source + 1];
      rgba[target + 2] = frame.buffer[source + 2];
      rgba[target + 3] = 255;
      break;
    }
  }
  return rgba;
}

export function sharpFromVisionFrame(input: VisionFrameInput) {
  if (!isRawVideoFrame(input)) return sharp(input);
  return sharp(rawFrameToRgbaBuffer(input), {
    raw: { width: input.width, height: input.height, channels: 4 },
  });
}
