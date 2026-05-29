# Installed Unity CV Library Analysis - 2026-05-26

## Source

- Snapshot: `data/adb-assets/device-snapshot/2.1.67.11733`
- Full generated index: `data/adb-assets/unity-cv-library-index.json`
- Scanner: `backend/tools/analyzeUnityCvLibrary.py`
- Atlas extraction support: `backend/tools/extractUnityTextures.py`

## Inventory

The snapshot contains `99,517` Unity bundles (`8,887.7 MB`). Every bundle path was inventoried, and
`11,753` likely relevant bundles were opened with UnityPy for object and texture inspection. There
were no decode errors.

| Family | Bundles | Approx. size |
| --- | ---: | ---: |
| Art | 90,699 | 7,432.5 MB |
| UI | 6,900 | 984.5 MB |
| TextAsset | 611 | 1.2 MB |
| Document | 511 | 74.0 MB |
| img | 335 | 50.3 MB |
| Scenes | 21 | 160.3 MB |

`67,113` Art bundles (`6,498.4 MB`) are skin/action/effect material. They are useful for a visual
asset library, but are generally unstable CV references because they are animation, particle, model,
or cosmetic effect resources rather than fixed HUD surfaces.

## CV Surface Findings

| Surface | Named bundles | Bundles confirmed by contents | Candidate textures |
| --- | ---: | ---: | ---: |
| Hero heads | 73 | 56 | 425 |
| Skin heads | 24 | 19 | 38 atlas textures |
| Draft | 92 | 8 | 175 |
| Lanes and roles | 306 | 45 | 805 |
| Battle/skill icons | 70 | 38 | 167 |
| Minimap | 19 | 1 | 24 |
| Live HUD | 97 | 3 | 321 |
| Items/builds | 37 | 7 | 51 |
| Loading | 143 | 48 | 748 |
| Score/results | 364 | 4 | 1,139 |
| Objectives | 2,024 | 284 | 5,489 |

## Atlas Discovery

Several detector-critical assets are packed into atlas sheets and were not usable as individual
icons until the extractor was updated to read `MonoBehaviour.mSprites` rectangles.

Running the updated extractor across the locally pulled CV set (`810` bundles) produced:

| Extracted reference group | Count |
| --- | ---: |
| Atlas sub-icons total | 3,980 |
| Official `SkinHead` sub-icons | 1,094 |
| Lane-related sub-icons | 38 |
| Skill/spell-atlas sub-icons | 938 |
| Minimap sub-icons | 12 |

The `1,094` installed-game `SkinHead` crops cover `132` hero IDs and preserve hero identity in their
sprite names (for example, `SkinHead001_06`), making them the preferred official reference set for
skin-mode draft rails.

Verified examples:

- `Atlas_ChooseLane02_add/sprites/LaneIcon01.png` is a clean lane badge.
- `Atlas_SkinHeadIcon02_add/sprites/SkinHead001_06.png` is an official cropped skin face.
- `Atlas_SkillIcon/sprites/B1210.png` is a clean ability/spell-style icon crop.

## Immediate Detector Sources

| Need | Official installed-game source | Use |
| --- | --- | --- |
| Base hero draft identity | `Atlas_Hero_Head` | Existing base icon matching |
| Locked/final draft skin portrait identity | `Atlas_SkinHeadIcon*_add` | Prefer as official final-pick identity templates |
| Assigned lane detection | `Atlas_ChooseLane02_add`, `Atlas_ChooseLane_add` | Train lane-marker matcher for the highlighted local slot |
| Battle-spell detection | `Atlas_SkillIcon*` | Isolate displayed battle-spell icons against draft crops |
| Minimap registration | `Atlas_minimap_add`, `UI_MiniMap*` | Establish minimap bounds and stable chrome |
| Item/build detection | `Atlas_EquipIcon`, `Atlas_ItemIcon`, `UI_BattlePlan*` | Build/shop icon recognition |
| Draft/screen state | `UI_ChooseHeroBP*`, `UI_BanList`, `Atlas_BattleLoading*` | Strengthen screen and draft phase gating |

## Training Priority

1. Completed: official `SkinHead` sub-icons are compiled into the draft model as `2,176` normal
   and mirrored identity references from `1,088` unique images covering `132` heroes. Augmented
   identity validation is `1,088 / 1,088`. A human-confirmed final-draft replay crop from the
   Mythic recording also passes: ally slot 3 matches Lesley through official `SkinHead53_06` at
   `0.8964` confidence and `0.0573` margin (`1 / 1` accepted) with the production confidence and
   margin gates unchanged.
2. Completed: all five lane markers now load from official `Atlas_ChooseLane02_add` crops. The
   finalized Mythic replay confirms the yellow-highlighted local slot as `gold` at `0.8580`
   confidence.
3. Completed for verified spells: official `Atlas_SkillIcon` templates classify the finalized
   Mythic ally row as `Retribution`, `Execute`, `Flicker`, `Flicker`, `Flicker` in slots 1-5.
   `Arrival` remains unsupported until its official sprite is proven.
4. Use minimap and objective atlases only after extracting labeled live-game crops; the raw objective
   pool includes many skins/effects that should not be accepted as screen facts.
