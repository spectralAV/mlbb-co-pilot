export type Role = {
  id: number;
  title: string;
  icon?: string;
};

export type Lane = {
  id: number;
  title: string;
  icon?: string;
};

export type HeroRelation = {
  assist: number[];
  strong: number[];
  weak: number[];
};

export type HeroRuntime = {
  id: number;
  channelId?: number;
  name: string;
  icon?: string;
  head?: string;
  portrait?: string;
  painting?: string;
  roles: Role[];
  lanes: Lane[];
  relations: HeroRelation;
  meta?: {
    winRate?: number;
    banRate?: number;
    appearanceRate?: number;
    topSynergies?: { heroId: number; deltaWinRate: number; icon?: string }[];
  };
};

export type RuntimeBundle = {
  generatedAt: string;
  sources: Record<string, unknown>;
  heroes: HeroRuntime[];
};
