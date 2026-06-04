# CV Device Adaptation Contract

MLBB Co-Pilot CV must support many phones, capture cards, emulators, and stream layouts by adapting regions of interest. Do not design or train separate production models for each device resolution.

## Core Rule

The model should recognize stable visual facts and UI surfaces. Device differences should be handled by layout adaptation, calibration, and confidence-gated ROI routing.

## Required Design

- Use normalized coordinates for stored regions, detections, projections, and calibration presets.
- Convert to pixels only at the capture, crop, or rendering boundary.
- Detect dynamic UI anchors before reading dependent regions. Examples include minimap bounds, draft rails, scoreboard modal bounds, item panels, timer areas, and self/highlight markers.
- Maintain aspect-ratio layout profiles for common capture shapes such as `16:9`, `20:9`, tablet-like layouts, and custom capture-card feeds.
- Prefer calibrated ROIs when saved calibration exists, and fall back to default normalized profiles when it does not.
- Use ROI-based detectors so each recognizer reads the smallest relevant surface instead of the full frame whenever possible.
- Apply confidence gates before updating match state, draft state, timer state, map state, or coaching calls.
- Keep manual override available for player profile, lane, picks, timers, objective state, enemy visibility, map zones, and calibration regions.

## Non-Goals

- Do not create a different production model for every screen size.
- Do not hardcode a single source resolution as the truth.
- Do not let low-confidence full-frame detections overwrite calibrated or manually confirmed state.
- Do not infer hidden enemies, timers, or draft facts from layout assumptions alone.

## Pipeline Shape

1. Capture the full frame with source width, height, and aspect ratio.
2. Select the closest normalized aspect-ratio profile.
3. Detect or validate major UI anchors.
4. Adapt ROIs from anchors and saved calibration.
5. Run surface-specific detectors and matchers inside those ROIs. Draft ban/pick crops prefer per-slot YOLO boxes (`ally_ban_slot`, `ally_pick_slot`, etc.) when the Ultralytics model is available; missing slots fall back to calibrated or default normalized rails.
6. Gate facts by owner, surface, confidence, temporal stability, and current screen state.
7. Merge accepted facts with manual overrides and existing match state.

Runtime Ultralytics inference is screen-gated: draft screens request draft anchor classes only, `live_hud` requests minimap/HUD classes, and `loading`/`lobby` skip YOLO entirely. Between YOLO ticks, cached detections still drive draft slot geometry and minimap panel crops; color minimap blobs merge with cached YOLO hero markers.

Training data should include multiple aspect ratios and UI states so the recognizers learn robust surfaces. Runtime adaptation still happens through normalized coordinates, anchors, calibration, and confidence gates rather than per-device model branching.

## Live Capture Flow

1. `LiveCapture` receives a frame from scrcpy (preferred for Android live CV), ADB PNG stills (diagnostics/fallback), OBS, NDI, a capture card, a browser window, or a recording.
2. The runtime records source width, height, and aspect ratio.
3. The runtime selects the likely layout profile, such as `20:9 phone`, `19.5:9 phone`, `16:9 video`, tablet, or custom.
4. The runtime validates minimap, timer/HUD, draft rail, and scoreboard anchors from calibrated normalized ROIs.
5. The runtime emits a live CV observation with screen state, layout profile, anchors, evidence, and confidence.
6. `GamePage` merges CV facts only when the observation passes confidence and freshness gates.
7. The user can manually correct lane pressure, objective timers, events, map zones, hero/role context, and CV calibration state.
8. The user can save the corrected normalized regions as a calibration profile for future frames from the same capture shape.
