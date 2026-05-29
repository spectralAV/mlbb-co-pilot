import test from "node:test";
import assert from "node:assert/strict";
import { parseSkinPortraits } from "../backend/src/vision/skinPortraitRecognition.ts";

test("skin portrait catalogue parses eager defaults and lazy cosmetic portraits", () => {
  const html = [
    '<div class="skin-box"><img alt="Hero1091-portrait" src="https://static.wikia.nocookie.net/mobile-legends/images/c/c8/Hero1091-portrait.png/revision/latest/scale-to-width-down/150?cb=1"><div class="skin-box-name"><span>Duke of Shards</span></div></div>',
    '<div class="skin-box"><img data-image-name="Hero1092-portrait.png" data-src="https://static.wikia.nocookie.net/mobile-legends/images/3/3a/Hero1092-portrait.png/revision/latest/scale-to-width-down/150?cb=2"><div class="skin-box-name"><span>Night&#39;s Edge</span></div></div>',
    '<div class="skin-box"><img data-image-name="Hero1092-portrait.png" data-src="https://static.wikia.nocookie.net/mobile-legends/images/3/3a/Hero1092-portrait.png/revision/latest/scale-to-width-down/150?cb=2"><div class="skin-box-name"><span>Repainted Edge</span></div></div>',
  ].join("");

  assert.deepEqual(parseSkinPortraits(html), [
    {
      id: "Hero1091-portrait",
      name: "Duke of Shards",
      fileName: "Hero1091-portrait.png",
      imageUrl: "https://static.wikia.nocookie.net/mobile-legends/images/c/c8/Hero1091-portrait.png/revision/latest?cb=1",
      source: "wiki",
    },
    {
      id: "Hero1092-portrait",
      name: "Night's Edge",
      fileName: "Hero1092-portrait.png",
      imageUrl: "https://static.wikia.nocookie.net/mobile-legends/images/3/3a/Hero1092-portrait.png/revision/latest?cb=2",
      source: "wiki",
    },
  ]);
});
