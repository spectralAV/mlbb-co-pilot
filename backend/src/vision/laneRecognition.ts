export type LaneReference = {
  id: number;
  key: "exp" | "jungle" | "mid" | "roam" | "gold";
  name: string;
  texture: string;
};

const lanes: LaneReference[] = [
  { id: 1, key: "exp", name: "Exp Lane", texture: "Atlas_ChooseLane02_add/sprites/LaneIcon01.png" },
  { id: 2, key: "mid", name: "Mid Lane", texture: "Atlas_ChooseLane02_add/sprites/LaneIcon02.png" },
  { id: 3, key: "roam", name: "Roam", texture: "Atlas_ChooseLane02_add/sprites/LaneIcon03.png" },
  { id: 4, key: "jungle", name: "Jungle", texture: "Atlas_ChooseLane02_add/sprites/LaneIcon04.png" },
  { id: 5, key: "gold", name: "Gold Lane", texture: "Atlas_ChooseLane02_add/sprites/LaneIcon05.png" },
];

export function getLaneRecognitionManifest() {
  return {
    version: "0.2",
    source: "installed MLBB Atlas_ChooseLane02_add textures via ADB",
    supportedFact: "draft-lane-icon",
    lanes,
  };
}

export function getLaneRecognitionReference(laneId: number) {
  return lanes.find((lane) => lane.id === laneId) ?? null;
}
