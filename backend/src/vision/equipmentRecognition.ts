export type EquipmentRecognitionReference = {
  id: number;
  name: string;
  texture: string;
};

// These item identities were conservatively cross-matched between the local
// installed-game atlas and the cached semantic item library.
const equipmentReferences: EquipmentRecognitionReference[] = [
  { id: 2006, name: "Demon Hunter Sword", texture: "Atlas_EquipIcon/sprites/2006.png" },
  { id: 2008, name: "Corrosion Scythe", texture: "Atlas_EquipIcon/sprites/2008.png" },
  { id: 2009, name: "Golden Staff", texture: "Atlas_EquipIcon/sprites/2009.png" },
  { id: 2014, name: "Sky Piercer", texture: "Atlas_EquipIcon02/sprites/2014.png" },
  { id: 2301, name: "Warrior Boots", texture: "Atlas_EquipIcon/sprites/2301.png" },
  { id: 2302, name: "Tough Boots", texture: "Atlas_EquipIcon/sprites/2302.png" },
  { id: 2303, name: "Magic Shoes", texture: "Atlas_EquipIcon/sprites/2303.png" },
  { id: 2304, name: "Arcane Boots", texture: "Atlas_EquipIcon/sprites/2304.png" },
  { id: 2305, name: "Swift Boots", texture: "Atlas_EquipIcon/sprites/2305.png" },
  { id: 2308, name: "Demon Shoes", texture: "Atlas_EquipIcon/sprites/2308.png" },
  { id: 3001, name: "Malefic Roar", texture: "Atlas_EquipIcon/sprites/3001.png" },
  { id: 3002, name: "Haas' Claws", texture: "Atlas_EquipIcon/sprites/3002.png" },
  { id: 3003, name: "Berserker's Fury", texture: "Atlas_EquipIcon/sprites/3003.png" },
  { id: 3004, name: "Endless Battle", texture: "Atlas_EquipIcon/sprites/3004.png" },
  { id: 3005, name: "Windtalker", texture: "Atlas_EquipIcon/sprites/3005.png" },
  { id: 3007, name: "Blade of the Heptaseas", texture: "Atlas_EquipIcon/sprites/3007.png" },
  { id: 3008, name: "Blade of Despair", texture: "Atlas_EquipIcon/sprites/3008.png" },
  { id: 3009, name: "Hunter Strike", texture: "Atlas_EquipIcon/sprites/3009.png" },
  { id: 3012, name: "Rose Gold Meteor", texture: "Atlas_EquipIcon/sprites/3012.png" },
  { id: 3013, name: "Sea Halberd", texture: "Atlas_EquipIcon/sprites/3013.png" },
  { id: 3014, name: "Great Dragon Spear", texture: "Atlas_EquipIcon02/sprites/3014.png" },
  { id: 3015, name: "Malefic Gun", texture: "Atlas_EquipIcon02/sprites/3015.png" },
  { id: 3101, name: "Divine Glaive", texture: "Atlas_EquipIcon/sprites/3101.png" },
  { id: 3102, name: "Holy Crystal", texture: "Atlas_EquipIcon/sprites/3102.png" },
  { id: 3103, name: "Concentrated Energy", texture: "Atlas_EquipIcon/sprites/3103.png" },
  { id: 3104, name: "Ice Queen Wand", texture: "Atlas_EquipIcon/sprites/3104.png" },
  { id: 3106, name: "Starlium Scythe", texture: "Atlas_EquipIcon/sprites/3106.png" },
  { id: 3107, name: "Clock of Destiny", texture: "Atlas_EquipIcon/sprites/3107.png" },
  { id: 3108, name: "Blood Wings", texture: "Atlas_EquipIcon/sprites/3108.png" },
  { id: 3110, name: "Lightning Truncheon", texture: "Atlas_EquipIcon/sprites/3110.png" },
  { id: 3111, name: "Genius Wand", texture: "Atlas_EquipIcon02/sprites/3111.png" },
  { id: 3112, name: "Flask of the Oasis", texture: "Atlas_EquipIcon02/sprites/3112.png" },
  { id: 31052, name: "Glowing Wand", texture: "Atlas_EquipIcon02/sprites/31052.png" },
  { id: 3201, name: "Cursed Helmet", texture: "Atlas_EquipIcon/sprites/3201.png" },
  { id: 3202, name: "Guardian Helmet", texture: "Atlas_EquipIcon/sprites/3202.png" },
  { id: 3203, name: "Antique Cuirass", texture: "Atlas_EquipIcon/sprites/3203.png" },
  { id: 3204, name: "Oracle", texture: "Atlas_EquipIcon/sprites/3204.png" },
  { id: 3205, name: "Athena's Shield", texture: "Atlas_EquipIcon/sprites/3205.png" },
  { id: 3206, name: "Dominance Ice", texture: "Atlas_EquipIcon/sprites/3206.png" },
  { id: 3207, name: "Immortality", texture: "Atlas_EquipIcon/sprites/3207.png" },
  { id: 3208, name: "Brute Force Breastplate", texture: "Atlas_EquipIcon/sprites/3208.png" },
  { id: 3210, name: "Radiant Armor", texture: "Atlas_EquipIcon02/sprites/3210.png" },
  { id: 3211, name: "Fleeting Time", texture: "Atlas_EquipIcon02/sprites/3211.png" },
];

export function getEquipmentRecognitionManifest() {
  return {
    source: "installed-game-atlas",
    items: equipmentReferences.map((item) => ({
      ...item,
      iconUrl: `/api/vision/equipment/icon/${item.id}`,
    })),
  };
}

export function getEquipmentRecognitionReference(id: number) {
  return equipmentReferences.find((item) => item.id === id) ?? null;
}
