# Coach Reasoning Model

The live coach uses a deterministic scenario catalog in `backend/src/engines/liveReasoningEngine.ts`.
It evaluates trusted vision, draft, timer, item, lane, and map signals in priority order, then returns one primary callout plus up to three alternatives.

## Output Contract

Every reasoning response includes:

- `ruleId`: stable rule key for tests and UI behavior.
- `scenario`: category, id, and tags for model introspection.
- `scene`: director surface: `main`, `map`, `text`, `counter`, or `picks`.
- `priority`: `low`, `medium`, or `high`.
- `callout`, `reason`, `recommendedAction`: the coach-facing decision.
- `nextActions`, `warnings`, `evidence`, `alternatives`: supporting explanation and nearby scenarios.
- `observation`: normalized match facts used by the model.
- `modelVersion`: current model version.

## Scenario Coverage

| Category | Rules | Purpose |
| --- | --- | --- |
| Lifecycle | `confidence_gate`, `lobby_idle`, `explicit_warning` | Suppress unsafe calls, wait in lobby, or honor trusted external warnings. |
| Draft | `draft_state` | Route draft/loading screens into pick, counter, spell, lane, and opening-plan reasoning. |
| Tempo | `death_reset`, `low_health_reset`, `spend_gold_power_spike`, `ahead_invade_window`, `behind_safe_farm`, `early_clear_plan` | Decide when to reset, spend, invade, stabilize, or keep the first clear clean. |
| Defense | `base_under_attack`, `split_push_threat` | Protect base, inhibitors, turrets, Lord waves, and side-lane structure pressure. |
| Fight | `lost_fight_disengage`, `numbers_advantage_force` | Convert numbers advantage or disengage when ally death timers make fights unsafe. |
| Items | `anti_heal_gap`, `enemy_item_spike`, `build_review` | React to sustain threats, enemy item spikes, scoreboard review, and shop states. |
| Objective | `objective_active_secure`, `objective_active_contest`, `objective_blind_risk`, `objective_trade_behind`, `objective_numbers_advantage`, `objective_setup` | Handle active Turtle/Lord, setup windows, blind starts, behind-state trades, and death-timer objective windows. |
| Lane | `gold_lane_collapse`, `exp_lane_dive_risk`, `mid_no_priority` | Detect gank/dive/rotation risk from lane pressure plus missing enemy information. |
| Map | `all_enemies_missing`, `missing_enemies`, `minimap_activity`, `stable_state` | Track enemy visibility, minimap movement, and provide a safe fallback. |

## Input Signals

The model accepts partial state. Missing facts do not block evaluation; they simply fall back to safer calls.

- Screen and trust: `screen`, `confidence`, `frameId`, `source`, `timestamp`.
- Minimap: `minimapMarkers`, `signals.mapMonitor.visibleEnemies`, `lastSeenEnemies`, `visibleObjectives`.
- Objectives: `objectiveName`, `objectiveSpawnsInSec`, `objectiveSoon`, `objectiveActive`, trusted timer facts.
- Draft/live context: `phase`, `matchTimeSeconds`, `role`, `selectedHero`, `goldState`, `goldLead`.
- Lane pressure: `lanePressure.exp`, `lanePressure.mid`, `lanePressure.gold`, `laneToPressure`.
- Fight state: `deadAllies`, `deadEnemies`, respawn timers, `alliesNearby`, `enemiesNearby`.
- Item state: `enemyItems`, `allyItems`, `enemyHealingThreats`, `teamHasAntiHeal`.
- Tempo/defense flags: `lowHealth`, `needReset`, `unspentGold`, `powerSpikeReady`, `baseUnderAttack`, `splitPushThreat`, `enemyLordPush`, `lordEnhancedMinions`, `invadeWindow`.

## API

```text
GET  /api/reasoning/live/latest
POST /api/reasoning/live/evaluate
GET  /api/reasoning/live/scenarios
```

`/api/reasoning/live/scenarios` returns the public scenario catalog for UI inspection, debugging, and future tuning screens.
