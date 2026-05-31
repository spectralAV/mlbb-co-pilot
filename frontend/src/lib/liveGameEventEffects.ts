import type { GameEvent, GameState, MapZoneId, MapZoneState, ZoneStatus } from "./gameTypes";

const objectiveRespawnSeconds = {
  turtle: 120,
  lord: 180
} as const;

export function applyGameEventToState(state: GameState, event: GameEvent): GameState {
  const next: GameState = {
    ...state,
    events: [event, ...state.events].slice(0, 80)
  };
  const label = event.label.toLowerCase();

  if (label.includes("jungler top")) {
    return {
      ...next,
      enemyMissing: { ...next.enemyMissing, jungler: false },
      lastEnemySeen: { ...next.lastEnemySeen, jungler: "river_exp" },
      mapZones: markZones(next.mapZones, [
        ["river_exp", "danger", "Enemy jungler top side"],
        ["exp_lane", "danger", "Enemy jungler can pressure EXP"],
        ["river_gold", "safe", "Jungler shown top side"]
      ])
    };
  }

  if (label.includes("jungler bot")) {
    return {
      ...next,
      enemyMissing: { ...next.enemyMissing, jungler: false },
      lastEnemySeen: { ...next.lastEnemySeen, jungler: "river_gold" },
      mapZones: markZones(next.mapZones, [
        ["river_gold", "danger", "Enemy jungler bot side"],
        ["gold_lane", "danger", "Enemy jungler can pressure Gold"],
        ["river_exp", "safe", "Jungler shown bot side"]
      ])
    };
  }

  if (label.includes("roam missing")) {
    return {
      ...next,
      enemyMissing: { ...next.enemyMissing, roam: true },
      lastEnemySeen: { ...next.lastEnemySeen, roam: undefined },
      mapZones: markZones(next.mapZones, [
        ["river_exp", "contested", "Roam missing"],
        ["river_gold", "contested", "Roam missing"],
        ["mid_lane", "contested", "Roam missing"]
      ])
    };
  }

  if (label.includes("mid missing")) {
    return {
      ...next,
      enemyMissing: { ...next.enemyMissing, mid: true },
      lastEnemySeen: { ...next.lastEnemySeen, mid: undefined },
      mapZones: markZones(next.mapZones, [
        ["river_exp", "danger", "Mid missing"],
        ["river_gold", "danger", "Mid missing"],
        ["mid_lane", "danger", "Mid missing"]
      ])
    };
  }

  if (label.includes("won fight")) {
    return { ...next, mode: next.mode === "review" ? "live" : next.mode };
  }

  if (label.includes("lost fight")) {
    return {
      ...next,
      mapZones: markZones(next.mapZones, [["objective_pit", "contested", "Lost fight, objective access uncertain"]])
    };
  }

  if (label.includes("i died")) {
    return { ...next, mode: "review" };
  }

  if (label.includes("reset") || label.includes("recall") || label.includes("respawn")) {
    return {
      ...next,
      mode: "live",
      mapZones: markZones(next.mapZones, [["ally_base", "safe", "Reset completed"]])
    };
  }

  if (label.includes("turtle taken")) {
    return markObjectiveTaken(next, "turtle");
  }

  if (label.includes("lord taken")) {
    return markObjectiveTaken(next, "lord");
  }

  return next;
}

export function markObjectiveTaken(state: GameState, objective: keyof typeof objectiveRespawnSeconds): GameState {
  return {
    ...state,
    objectiveTimers: {
      ...state.objectiveTimers,
      [objective]: objectiveRespawnSeconds[objective]
    },
    mapZones: markZones(state.mapZones, [["objective_pit", "safe", `${objective === "turtle" ? "Turtle" : "Lord"} taken`]])
  };
}

function markZones(zones: MapZoneState[], updates: Array<[MapZoneId, ZoneStatus, string]>): MapZoneState[] {
  const now = Date.now();
  const updateByZone = new Map<MapZoneId, { status: ZoneStatus; notes: string }>(
    updates.map(([id, status, notes]) => [id, { status, notes }])
  );
  return zones.map((zone) => {
    const update = updateByZone.get(zone.id);
    return update ? { ...zone, status: update.status, notes: update.notes, lastUpdatedAt: now } : zone;
  });
}
