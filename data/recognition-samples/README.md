# MLBB Recognition Samples

This folder is for local screenshot samples used to train/verify UI recognition.

Image samples are ignored by Git because they can contain personal avatars, friend names, and account information.

## Current Region Map

`region-map-ranked-lobby-2856x1280.json` maps the Ranked lobby avatar banner and queue slot regions from a `2856x1280` capture.

`region-map-ranked-choose-lane-2856x1280.json` maps the Ranked Choose Lane overlay. That screen is different from the lobby banner layout and includes six large cards:

- `exp_card`
- `jungle_card`
- `mid_card`
- `roam_card`
- `gold_card`
- `flex_card`

`flex_card` is a prematch shortcut, not a sixth role. It means the player accepts all five actual roles.

Important regions:

- `player_banner_full`
- `player_avatar_frame`
- `player_role_icon`
- `party_slot_0_leader_banner`
- `party_slot_1_card` through `party_slot_4_card`
- `party_slot_1_avatar_area` through `party_slot_4_avatar_area`
- `party_slot_1_lower_role_area` through `party_slot_4_lower_role_area`
- region groups: `party_cards`, `party_avatar_areas`, `party_role_icon_areas`
- `queue_slots_full`
- `queue_slot_1` through `queue_slot_4`
- `start_game_button`

## Needed Samples

Capture enough variation for:

- `solo`
- `duo`
- `trio`
- `five_man`

And role labels:

- `jungle`
- `exp`
- `gold`
- `mid`
- `roam`
- `unknown`

And dynamic icon states:

- `swap`
- `fill`
- `role_jungle`
- `role_exp`
- `role_gold`
- `role_mid`
- `role_roam`
- `unknown`

Prematch role selection rules:

- actual roles are `exp`, `jungle`, `mid`, `roam`, and `gold`
- the Choose Lane screen can select up to five accepted roles before matchmaking
- `Flex Pro` means all five actual roles are accepted
- after matchmaking, the player receives one actual role
- if only `roam` is selected, matchmaking keeps the player roam-only

Suggested minimum per combination: 5 screenshots.

Party size matters because this screen can contain multiple player cards at once:

- slot 0 is your left-side leader banner
- in solo, only slot 0 can have your selected role
- slots 1-4 are central teammate cards/placeholders
- in duo, expect slot 0 + one filled teammate slot
- in trio, expect slot 0 + two filled teammate slots
- in five-man, expect all five slots populated

Solo prematch samples should record the selected role set:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_choose_lane -Queue solo -Role unknown -IconState multi_role -SelectedRoles exp,jungle,mid
```

Roam-only and Flex Pro examples:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_choose_lane -Queue solo -Role roam -IconState single_role -SelectedRoles roam
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_choose_lane -Queue solo -Role unknown -IconState flex_all
```

## Workflow

1. Open the target MLBB screen on the device.
2. Run `tools/capture-mlbb-recognition-sample.ps1`.
3. Pass queue, role, and icon-state labels in the filename/manifest.
4. Review crops before using them for recognition.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\capture-mlbb-recognition-sample.ps1 -Screen ranked_lobby -Queue solo -Role unknown -IconState swap
```
