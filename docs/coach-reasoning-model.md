# Coach Reasoning Model

Dual-lane coach: **System 1** (fast, deterministic) and **System 2** (advisory, async stub with future sidecar seam).

## System 1 — Fast Lane

`backend/src/engines/liveReasoningEngine.ts` — `LIVE_REASONING_MODEL_VERSION = coach-scenario-v2`

Evaluates trusted vision, draft, timer, item, lane, and map signals in priority order. Returns one primary callout plus up to three alternatives. Never blocks; runs every vision/reasoning tick.

### Output Contract

- `ruleId`, `scenario`, `scene`, `priority`
- `callout`, `reason`, `recommendedAction`
- `nextActions`, `warnings`, `evidence`, `alternatives`
- `observation`, `modelVersion`

### Scenario Coverage (v2)

| Category | Rules | Purpose |
| --- | --- | --- |
| Lifecycle | `confidence_gate`, `lobby_idle`, `explicit_warning` | Suppress unsafe calls, lobby, external warnings |
| Draft | `draft_state` | Draft/loading pick and opening plan |
| Tempo | `death_reset`, `low_health_reset`, `spend_gold_power_spike`, `ahead_invade_window`, `behind_safe_farm`, `buff_contest_window`, `defensive_warding_behind`, `early_clear_plan` | Reset, spend, invade, stabilize, buffs, wards |
| Defense | `base_under_attack`, `split_push_threat` | Base, Lord wave, side lane |
| Fight | `lost_fight_disengage`, `numbers_advantage_force`, `ultimate_ready_engage` | Numbers, ult spike |
| Items | `anti_heal_gap`, `enemy_item_spike`, `build_review` | Sustain, spikes, shop |
| Objective | `objective_active_secure`, `objective_active_contest`, `objective_blind_risk`, `objective_trade_behind`, `objective_numbers_advantage`, `lord_late_priority`, `turtle_early_setup`, `wave_crash_objective`, `objective_setup` | Turtle/Lord, blind, trade, wave crash |
| Lane | `gold_lane_collapse`, `exp_lane_dive_risk`, `mid_no_priority`, `mid_rotation_winning`, `roam_gank_setup` | Lanes, roam, ganks |
| Map | `all_enemies_missing`, `missing_enemies`, `minimap_activity`, `stable_state` | Vision, fallback |

Game knowledge reference: `docs/mlbb-match-logic.md`.

## System 2 — Advisory Lane

| File | Role |
| --- | --- |
| `advisoryCoach.ts` | `AdvisoryCoach` interface, bounded slots, `ADVISORY_COACH_CONFIG` |
| `heuristicAdvisoryCoach.ts` | Deterministic stub grounded on fast-lane output |
| `advisoryCoachLane.ts` | Async scheduling, throttle, fault isolation |

### Behavior

- Consumes same normalized input + **fast-lane decision**; must not contradict `ruleId` / primary callout.
- Throttled: meaningful changes (rule, priority, phase, gold, objective, deaths) or `ADVISORY_COACH_MIN_MS` (default 8000).
- Failures update `advisory_lane` with `status: "error"` only; **System 1 unchanged**.

### Output Contract

- `status`: `ready` | `skipped` | `error`
- `groundedRuleId`, `reasoning` (bounded text)
- `recommendations[]`: max 3 slots (`id`, `title`, `action`, `horizon`)
- `macroNotes[]`: max 2

### LLM / NPU Sidecar (phase 1 — HTTP client)

Set environment:

```bash
ADVISORY_COACH_PROVIDER=llm-sidecar
ADVISORY_SIDECAR_URL=http://127.0.0.1:8790/advise
```

Dev stub (heuristic-style JSON):

```powershell
node tools/advisory-sidecar-stub/server.mjs
```

Health: `GET /api/reasoning/advisory/sidecar-health` (proxies sidecar `/health`).

Implementation: `backend/src/engines/llmSidecarAdvisoryCoach.ts` — POST `{ context, decision }`, validates `groundedRuleId`, falls back to heuristic on timeout/error.

Planned backends (separate phase): AMD Vitis AI, Intel OpenVINO, Qualcomm QNN, DML+CPU fallback.

## API

```text
GET  /api/reasoning/live/latest          # System 1
POST /api/reasoning/live/evaluate
GET  /api/reasoning/live/scenarios
GET  /api/reasoning/advisory/latest      # System 2
GET  /api/coach/state                    # includes instant_callout + advisory_lane
```

## Merge Point

`backend/src/services/obsCoachState.ts` exposes:

- `instant_callout` — fast lane snapshot (does not replace legacy `map_state.callouts`)
- `advisory_lane` — latest advisory output
- `advisory_config` — provider seam hint

Match state also stores `advisory` via `updateMatchAdvisory()` for overlay consumers using `/api/match/state`.
