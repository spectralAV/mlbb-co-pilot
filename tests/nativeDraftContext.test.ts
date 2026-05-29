import assert from "node:assert/strict";
import { test } from "node:test";
import { detectNativeDraftVisualContext } from "../backend/src/vision/nativeDraftContext.ts";

test("native OBS BMP detector identifies ally first-pick marker", () => {
  const bmp = createBmp(1000, 500);
  paint(bmp, [0.278, 0.032, 0.052, 0.072], [35, 130, 242]);
  const context = detectNativeDraftVisualContext(bmp.buffer);
  assert.equal(context.firstPickSide?.value, "ally");
});

test("native OBS BMP detector identifies enemy first-pick marker and self slot", () => {
  const bmp = createBmp(1000, 500);
  paint(bmp, [0.702, 0.032, 0.052, 0.072], [232, 58, 72]);
  paint(bmp, [0.04, 0.112 + 0.812 * 2 / 5 + (0.812 / 5) * 0.62, 0.1, (0.812 / 5) * 0.32], [224, 177, 30]);
  const context = detectNativeDraftVisualContext(bmp.buffer);
  assert.equal(context.firstPickSide?.value, "enemy");
  assert.equal(context.selfSlot?.value, 3);
});

test("native OBS draft context uses calibrated first-pick regions", () => {
  const bmp = createBmp(1000, 500);
  paint(bmp, [0.15, 0.2, 0.06, 0.08], [232, 58, 72]);
  const context = detectNativeDraftVisualContext(bmp.buffer, {
    draft_first_pick_enemy_indicator_norm: [0.15, 0.2, 0.06, 0.08],
    draft_first_pick_ally_indicator_norm: [0.7, 0.2, 0.06, 0.08],
  });
  assert.equal(context.firstPickSide?.value, "enemy");
});

type BmpFixture = {
  buffer: Buffer;
  width: number;
  height: number;
  pixelOffset: number;
  rowStride: number;
};

function createBmp(width: number, height: number): BmpFixture {
  const bytesPerPixel = 3;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const pixelOffset = 54;
  const buffer = Buffer.alloc(pixelOffset + rowStride * height);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(buffer.byteLength, 2);
  buffer.writeUInt32LE(pixelOffset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(rowStride * height, 34);
  return { buffer, width, height, pixelOffset, rowStride };
}

function paint(bmp: BmpFixture, rect: [number, number, number, number], color: [number, number, number]) {
  for (let y = Math.floor(rect[1] * bmp.height); y < Math.ceil((rect[1] + rect[3]) * bmp.height); y += 1) {
    for (let x = Math.floor(rect[0] * bmp.width); x < Math.ceil((rect[0] + rect[2]) * bmp.width); x += 1) {
      const sourceY = bmp.height - y - 1;
      const index = bmp.pixelOffset + sourceY * bmp.rowStride + x * 3;
      bmp.buffer[index] = color[2];
      bmp.buffer[index + 1] = color[1];
      bmp.buffer[index + 2] = color[0];
    }
  }
}
