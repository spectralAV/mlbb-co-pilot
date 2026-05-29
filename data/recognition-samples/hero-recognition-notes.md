# Hero Recognition Notes

Hero detection is reference-driven. Official MLBB `head` and `smallmap` assets own each hero's current base design, including revamped portraits. The community-maintained Mobile Legends Wiki supplements those official assets with named skin portrait cards and compact skin face thumbnails.

## Runtime Manifest

- Endpoint: `/api/vision/heroes/manifest`
- Official source cache: `data/cache/compiled-heroes.json` and `data/cache/runtime.json`
- Supplemental skin gallery endpoint: `/api/vision/skins/manifest`
- Compiled skin face endpoint: `/api/vision/skins/signatures`
- Supplemental source: `https://mobile-legends.fandom.com/wiki/<Hero>/Cosmetics`
- Running official data sync refreshes the current base portrait/icon entries and rebuilds existing detector references so revamped designs do not remain stale in CV.
- Every hero icon exposes two required reference variants:
  - `normal`
  - `mirror-x`

Top ban slots use circular hero icons. Pick rails and loading screens use portrait/card art, often with skins. Icon and portrait references must not be mixed.

## Matching Strategy

1. Classify the scene: `draft_pick`, `loading_screen`, `equipment_panel`, `attributes_panel`, or `live_hud`.
2. For the current icon catalog, crop only supported icon slots such as draft ban circles.
3. Apply a circular icon mask, resize, and color-normalize.
4. Compare against icon templates for both `normal` and `mirror-x`.
5. Store the detected hero under its actual meaning, such as `allyBans`, never as a pick.
6. Match side-rail faces against the precompiled skin thumbnail signatures and accept only identities that clear confidence and margin gates; never load the catalogue per frame.

Hero names shown in a recorded selection provide validation evidence, not a live detector shortcut. Ban detection uses official icon references; pick detection uses confidence-gated official/current and compiled skin face references.

## Draft Comes First

Draft ban icon recognition is the first live CV stage. It runs before the match starts because recommendations can already exclude recognized bans while portrait detection is being prepared.

- Intake endpoint: `/api/vision/draft/recognition`
- Latest state endpoint: `/api/vision/draft/latest`
- Expected flow:
  1. Classify current scene as `draft_pick`.
  2. Match visible ally/enemy top-row ban icons against icon references.
  3. Preserve match confidence and whether the winning variant was `normal` or `mirror-x`.
  4. POST the recognized draft state immediately.
  5. Backend runs draft analysis and emits `draft_recognized` plus `draft_updated`.
  6. Draft Room and overlay can show ban-informed recommendations before loading screen or live match.

Side-rail skin matching is now enabled through the compact compiled thumbnail catalogue. In the Mythic finalize fixture, the visible `Angelic Agent` selection validates the accepted ally slot result as Lesley; low-margin rail images in the Legend fixture remain unclaimed. The locked ten-player draft view may switch from base designs to equipped skin art, so it continues to use skin references rather than treating appearance changes as a new hero.

## Draft Context

Draft context is independent of hero identity:

- the yellow-highlighted allied row identifies the local player's current draft slot;
- the blue-side or red-side `1st` indicator identifies which team receives first pick;
- the lane symbol on the highlighted row identifies the local assigned lane;
- circular badges on populated ally rows identify visible battle spells.

The installed-game `Atlas_ChooseLane02_add` extraction supplies the five lane references for Exp, Mid, Roam, Jungle, and Gold. The detector matches their bright emblem silhouette in both compact rows and the expanded selected-player row. Replay validation accepts `gold` for the Mythic frame where the screen explicitly says `Proceed to: Gold Lane`, and `exp` for the expanded highlighted Legend row.

The installed-game `Atlas_SkillIcon` extraction supplies verified battle-spell references. In the Mythic finalized row, the visible badges validate `Retribution`, `Execute`, `Flicker`, `Flicker`, and `Flicker` for ally slots 1 through 5. `Arrival` remains excluded from recognition until an official atlas sprite is identified confidently.

## Draft Recommendations

Draft analysis is deterministic. A saved player profile supplies preferred lane and comfort heroes until a confidence-scored detected lane overrides the preference. The spell rule layer consumes detected lane, detected self spell, and enemy identities; for example, a crowd-control-heavy enemy draft prioritizes `Purify`, while Jungle prioritizes `Retribution`.

## Minimap Markers

The live minimap displays team-colored positional markers: cyan-ring markers are allied candidates and red-ring markers are enemy candidates. This gives useful movement evidence before hero identity is known.

Color segmentation alone cannot distinguish every hero marker from same-team turrets, pings, or objective graphics. The live pipeline therefore publishes `team-color-candidate` markers with side, normalized minimap position, and confidence. It does not attach a hero name or icon until ring-shape validation and tiny interior-icon matching have been calibrated.

Once draft/loading composition recognition is reliable, minimap identity matching should be roster-scoped: a cyan marker compares only against the five allied detected heroes, and a red marker only against the five detected enemies. This reduces tiny-icon ambiguity substantially.
