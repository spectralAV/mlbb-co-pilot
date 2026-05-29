export type BattleSpellReference = {
  id: string;
  name: string;
  texture: string;
};

function idFor(name: string) {
  return name.toLowerCase().replace(/\s+/g, "_");
}

const officialSkillSprites: Array<[string, string]> = [
  ["Flicker", "S20100.png"],
  ["Retribution", "S20020.png"],
  ["Inspire", "S20030.png"],
  ["Flameshot", "S20220.png"],
  ["Vengeance", "S20190.png"],
  ["Petrify", "S20070.png"],
  ["Execute", "S20150.png"],
  ["Sprint", "S20040.png"],
  ["Purify", "S20080.png"],
  ["Aegis", "S20060.png"],
  ["Revitalize", "S20050.png"],
];

const spells: BattleSpellReference[] = officialSkillSprites.map(([name, sprite]) => ({
  id: idFor(name),
  name,
  texture: `Atlas_SkillIcon/sprites/${sprite}`,
}));

export function getBattleSpellRecognitionManifest() {
  return {
    version: "0.2",
    source: "installed MLBB Atlas_SkillIcon textures via ADB",
    supportedFact: "draft-battle-spell-icon",
    unsupportedUntilVerified: ["Arrival"],
    spells,
  };
}

export function getBattleSpellRecognitionReference(id: string) {
  return spells.find((spell) => spell.id === id) ?? null;
}
