# MLBB Match Logic (Coach Knowledge Base)

Structured reference for deterministic rules and the advisory coach stub. Sources are cited where external verification was used; timing values follow widely documented MLBB norms (patch drift may apply).

## Roles and Lanes

| Role | Lane | Primary responsibilities |
| --- | --- | --- |
| **Gold (Marksman/Carry)** | Bot | Farm safely, scale with items, siege turrets late; needs peel and vision before river. |
| **EXP (Fighter/Tank side)** | Top | Hold side lane, peel or dive as kit allows; answers split push and frontline. |
| **Mid (Mage/Assassin)** | Mid | Wave priority first; fastest rotation to Turtle/Lord and skirmishes. |
| **Jungle** | Jungle | Camp clear path, gank timing, secure/contest objectives with Retribution. |
| **Roam (Support/Tank)** | Rotates | Vision, engage/disengage, cover losing lanes, shot-call setup before objectives. |

**Coach heuristics:** Mid must clear wave before river; Gold cannot face-check missing roam/jungle; Jungle never starts objective blind; Roam tracks missing timers before rotating.

## Game Phases

| Phase | Approx. time | Goals |
| --- | --- | --- |
| **Early** | 0–5 min | First clear, lane stability, level 2/4 spikes, first Turtle setup (~2:00). |
| **Mid** | 5–12 min | Turret plates end (~8:00), rotations, second Turtle, vision for Lord. |
| **Late** | 12+ min | Lord priority, 5v5 positioning, base/inhib defense, avoid throw fights. |

Phase in this project: `matchTimeSeconds < 300` early, `< 720` mid, else late (see `normalizePhase` in `liveReasoningEngine.ts`).

## Jungle Economy and Buffs

- **Blue buff:** Mana/CDR-heavy junglers and many mages; contest when ahead with vision.
- **Red buff:** Basic-attack junglers and physical carries; buff control wins skirmishes.
- **Camps:** Full clear before gank unless lane is crashing; invade only with lane prio + missing enemy jungler info.
- **Retribution:** Required on jungler (or designated smite) for secure/contest on Turtle/Lord; never start objective without knowing enemy Retribution state when even/behind.

**Jungle items (common):** Hunter's Knife → core jungle item (e.g. Beast Killer / Ice Hunter paths); upgrade timing is a power spike.

**Coach heuristics:** Track buff respawn (~90s tier); invade one camp and leave; do not trade buff for structure.

## Objectives and Timings

| Objective | Typical spawn / cadence | Notes |
| --- | --- | --- |
| **Turtle** | First ~2:00, respawn ~2 min after kill | Gold to team, early snowball; setup requires mid wave + river vision. |
| **Lord** | After Turtle phase escalates (~8:00+ area) | Push lanes, enhanced minions on kill; late game win condition. |
| **Towers** | Plates early (~gold until ~8:00) | Plates end → play for picks and Lord, not coin flips. |
| **Inhib / Base** | — | Lord wave and split push threaten core; defend before jungle farm. |

References: [MLBB Turtle/Lord overview (Fandom)](https://mobile-legends.fandom.com/wiki/Turtle), [Game8 Lord guide](https://game8.co/games/Mobile-Legends/features/122385).

**Coach heuristics:** Setup 30–60s before spawn; never start blind with 3+ missing; behind → trade opposite map; numbers up → force secure.

## Lane Waves and Minions

- **Crash / slow push:** Before objective or roam; freeze only when safe with vision.
- **Catch:** Side lane losing → safest wave-clear hero catches, team does not 4v5 face-check.

## Rotations and Ganks

1. Clear own wave → move on timer → arrive with ally wave advantage.
2. Roam path: mid → gold/exp or bush from river with minimap info.
3. Counter-gank when enemy roam missing and your lane is losing.

**Coach heuristics:** Missing roam + losing gold = cover gold; winning mid + missing enemies = roam with caution.

## Power Spikes

| Spike | When | Action |
| --- | --- | --- |
| Level 4 | First ult tier | Roam/jungle gank window. |
| Level 6/12 | Ult upgrades | Teamfight tool online. |
| Core item | ~900–2000g component | Recall, spend, fight on completed item. |
| Retribution upgrade | Jungle item 2 | Objective secure threat. |

## Draft Logic (High Level)

| Archetype | Strength | Weakness |
| --- | --- | --- |
| **Poke** | Siege and chip | Engage all-in |
| **Dive** | Backline pick | Poke / peel walls |
| **Split** | Side pressure | Hard 5v5 without picks |
| **Teamfight** | Front-to-back 5v5 | Split / poke kiting |

**Counters / synergies:** Anti-heal vs sustain (Estes, Alice, etc.); physical/magic defense vs damage comp; hard CC vs mobile carries. Draft engine in repo handles pick scores; live coach uses detected picks when available.

## Vision and Map Control

- River bush before Turtle/Lord; entrance wards when behind.
- **Missing enemies:** 3+ = objective risk; 4+ = collapse; never face-check alone.
- Minimap markers (trusted CV) → rotation calls.

## Gold and XP Economy

- **Ahead (~1500+ lead):** Invade, press objectives, force fights with numbers.
- **Behind:** Safe waves, defend structure, trade maps, punish overextend.
- **Even:** Vision-first contests; avoid 50/50 Lord without info.

Comeback: pick on isolated carry, catch before Lord, defend base over jungle greed.

## Teamfight Macro

- **Engage:** Numbers or power spike + vision on backline.
- **Disengage:** Numbers down, low HP, no ult — reset waves.
- **Objective trade:** Give Lord if base dies; take turret/inhib opposite when 2+ enemies commit elsewhere.

## Decision Heuristics (Encode in Coach)

1. Base/Lord wave > jungle camp.
2. Spend gold before forcing fight.
3. Anti-heal before all-in vs heal comp.
4. Mid wave before river.
5. Objective only with vision or numbers.
6. Behind → trade, don't flip.
7. Numbers up → convert space in 10–15s window.
8. Death screen → rebuild map info before aggressive call.

## Related Project Docs

- `docs/coach-reasoning-model.md` — rule catalog and API.
- `backend/src/engines/liveReasoningEngine.ts` — System 1 (fast lane).
- `backend/src/engines/advisoryCoachLane.ts` — System 2 (advisory stub + future sidecar seam).
