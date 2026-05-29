export type MinimapMarkerCandidate = {
  id: string;
  side: "ally" | "enemy";
  markerClass: "team-color-candidate";
  minimap: [number, number];
  confidence: number;
  sampledAt: number;
};

export function detectMinimapMarkerCandidatesFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sampledAt: number,
) {
  const gridW = 96;
  const gridH = 96;
  const allyMask = new Uint8Array(gridW * gridH);
  const enemyMask = new Uint8Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy += 1) {
    const py = Math.min(height - 1, Math.floor((gy / gridH) * height));
    for (let gx = 0; gx < gridW; gx += 1) {
      const px = Math.min(width - 1, Math.floor((gx / gridW) * width));
      const pixel = (py * width + px) * 4;
      const red = rgba[pixel];
      const green = rgba[pixel + 1];
      const blue = rgba[pixel + 2];
      if (rgba[pixel + 3] < 16) continue;
      const index = gy * gridW + gx;
      if (isAllyPixel(red, green, blue)) allyMask[index] = 1;
      else if (isEnemyPixel(red, green, blue)) enemyMask[index] = 1;
    }
  }

  return [
    ...extractComponents("ally", allyMask, gridW, gridH, sampledAt),
    ...extractComponents("enemy", enemyMask, gridW, gridH, sampledAt),
  ]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 10)
    .map((marker, index) => ({ ...marker, id: `${marker.side}-${index}` }));
}

function isAllyPixel(red: number, green: number, blue: number) {
  return blue > 125 && green > 85 && red < 135 && blue - red > 35;
}

function isEnemyPixel(red: number, green: number, blue: number) {
  return red > 145 && green < 145 && red - blue > 35;
}

function extractComponents(
  side: "ally" | "enemy",
  mask: Uint8Array,
  gridW: number,
  gridH: number,
  sampledAt: number,
): MinimapMarkerCandidate[] {
  const visited = new Uint8Array(mask.length);
  const detections: MinimapMarkerCandidate[] = [];
  const queue: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const x = current % gridW;
      const y = Math.floor(current / gridW);
      area += 1;
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= gridW || nextY >= gridH) continue;
          const next = nextY * gridW + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    if (area < 4 || area > 450) continue;
    detections.push({
      id: `${side}-${detections.length}`,
      side,
      markerClass: "team-color-candidate",
      minimap: [sumX / area / (gridW - 1), sumY / area / (gridH - 1)],
      confidence: Math.max(0.25, Math.min(0.98, area / 80)),
      sampledAt,
    });
  }
  return detections;
}
