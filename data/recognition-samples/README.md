# MLBB Recognition Samples

This folder is for local screenshot samples used to train/verify UI recognition.

Image samples are ignored by Git because they can contain personal avatars, friend names, and account information.

## Current Region Map

`region-map-ranked-lobby-2856x1280.json` maps the Ranked lobby avatar banner and queue slot regions from a `2856x1280` capture.

Important regions:

- `player_banner_full`
- `player_avatar_frame`
- `player_role_icon`
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

## Workflow

1. Open the target MLBB screen on the device.
2. Run `tools/capture-mlbb-recognition-sample.ps1`.
3. Pass queue/role labels in the filename/folder.
4. Review crops before using them for recognition.
