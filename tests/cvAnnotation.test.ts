import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { annotationImage, getAnnotation, listAnnotations, normalizeAnnotationBoxes, updateAnnotation } from "../backend/src/vision/cvAnnotation.ts";

const projectRoot = path.resolve(process.cwd(), "..");
const cvRoot = path.join(projectRoot, "data", "cv");
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgYGD4z8DAwMgABXAGAwEAH3gCAAAAAElFTkSuQmCC",
  "base64",
);

test("CV annotations retain hero identity metadata only for minimap hero boxes", () => {
  const boxes = normalizeAnnotationBoxes([
    { classId: 11, rect: [0.1, 0.2, 0.1, 0.1], heroId: 7, heroName: "Alucard" },
    { classId: 13, rect: [0.3, 0.3, 0.1, 0.1], heroId: 7, heroName: "Alucard" },
    { classId: 10, rect: [0.5, 0.5, 0.1, 0.1], heroId: "invalid", heroName: "Karina" },
  ]);

  assert.deepEqual({ heroId: boxes[0].heroId, heroName: boxes[0].heroName }, { heroId: 7, heroName: "Alucard" });
  assert.equal(boxes[1].heroId, undefined);
  assert.equal(boxes[2].heroName, undefined);
});

test("CV annotations retain validated timer transcripts without altering detector labels", () => {
  const boxes = normalizeAnnotationBoxes([
    { classId: 17, rect: [0.1, 0.1, 0.2, 0.1], transcript: "01:20" },
    { classId: 18, rect: [0.1, 0.3, 0.2, 0.1], transcript: "43" },
    { classId: 21, rect: [0.1, 0.5, 0.2, 0.1], transcript: "abc" },
  ]);

  assert.equal(boxes[0].transcript, "01:20");
  assert.equal(boxes[1].transcript, "43");
  assert.equal(boxes[2].transcript, undefined);
  assert.deepEqual(boxes.map((box) => box.className), ["lord_respawn_timer", "enemy_respawn_timer", "score_counter"]);
});

test("annotation normalization clamps boxes that drift past the image edge", () => {
  const boxes = normalizeAnnotationBoxes([
    { classId: 0, rect: [0.95, 0.9, 0.2, 0.2] },
  ]);

  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0].rect, [0.95, 0.9, 0.05, 0.1]);
});

test("annotation normalization drops boxes that collapse after clamping", () => {
  const boxes = normalizeAnnotationBoxes([
    { classId: 0, rect: [1.2, 0.2, 0.1, 0.1] },
  ]);

  assert.deepEqual(boxes, []);
});

test("active CV dataset frames are listed, opened, and updated", async (t) => {
  const stem = `test-active-dataset-${Date.now()}`;
  const image = path.join(cvRoot, "images", "train", `${stem}.png`);
  const label = path.join(cvRoot, "labels", "train", `${stem}.txt`);
  t.after(async () => {
    await Promise.all([
      rm(image, { force: true }),
      rm(label, { force: true }),
      rm(path.join(cvRoot, "images", "val", `${stem}.png`), { force: true }),
      rm(path.join(cvRoot, "labels", "val", `${stem}.txt`), { force: true }),
    ]);
  });

  await mkdir(path.dirname(image), { recursive: true });
  await mkdir(path.dirname(label), { recursive: true });
  await writeFile(image, tinyPng);
  await writeFile(label, "0 0.500000 0.500000 0.250000 0.500000\n", "ascii");

  const id = `dataset-train-${stem}`;
  const listed = await listAnnotations();
  const sample = listed.find((entry) => entry.id === id);
  assert.equal(sample?.source, `${stem}.png`);
  assert.equal(sample?.split, "train");
  assert.deepEqual(sample?.boxes.map((box) => box.rect), [[0.375, 0.25, 0.25, 0.5]]);
  assert.equal((await getAnnotation(id))?.source, `${stem}.png`);
  assert.equal(await annotationImage(id), image);

  const updated = await updateAnnotation(id, {
    split: "train",
    boxes: [{ classId: 1, rect: [0.1, 0.2, 0.3, 0.4] }],
  });
  assert.equal(updated?.id, id);
  assert.equal(await readFile(label, "utf8"), "1 0.250000 0.400000 0.300000 0.400000\n");
});
