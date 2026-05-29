import assert from "node:assert/strict";
import { test } from "node:test";
import { officialHeroPortraitUrl } from "../backend/src/vision/heroRecognition.ts";

test("hero recognition uses painting art for portrait references", () => {
  assert.equal(
    officialHeroPortraitUrl({
      id: 1,
      icon: "https://assets.example/smallmap.png",
      portrait: "https://assets.example/smallmap.png",
      painting: "https://assets.example/painting.png",
    }),
    "https://assets.example/painting.png",
  );
});

test("hero recognition accepts freshly fetched nested painting assets", () => {
  assert.equal(
    officialHeroPortraitUrl({
      id: 2,
      icon: "https://assets.example/smallmap.png",
      data: { painting: "https://assets.example/nested-painting.png" },
    }),
    "https://assets.example/nested-painting.png",
  );
});
