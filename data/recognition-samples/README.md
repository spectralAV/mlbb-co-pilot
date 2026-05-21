# MLBB Recognition Samples

This folder is for local screenshot samples used to train/verify UI recognition.

Image samples are ignored by Git because they can contain personal avatars, friend names, and account information.

## Current Region Map

`region-map-ranked-lobby-2856x1280.json` maps the Ranked lobby avatar banner and queue slot regions from a `2856x1280` capture.

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

Suggested minimum per combination: 5 screenshots.

Party size matters because this screen can contain multiple player cards at once:

- slot 0 is your left-side leader banner
- slots 1-4 are the central teammate cards/placeholders
- in duo, expect slot 0 + one filled teammate slot
- in trio, expect slot 0 + two filled teammate slots
- in five-man, expect all five slots populated

## Workflow

1. Open the target MLBB screen on the device.
2. Run `tools/capture-mlbb-recognition-sample.ps1`.
3. Pass queue/role labels in the filename/folder.
4. Review crops before using them for recognition.
