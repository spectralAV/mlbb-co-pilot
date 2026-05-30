# Roadmap To 1.0.0

MLBB Co-Pilot is moving toward a stable `1.0.0` release through small public alpha and beta milestones.

## v0.5.x: Installable Desktop Alpha

Goal: make the installed app understandable on a clean Windows machine.

Acceptance criteria:

- Windows installer opens into a branded desktop shell.
- First-run setup screen checks backend, runtime data, phone capture, CV model status, and optional stream integrations.
- App icon and installer metadata are present.
- User-facing docs describe installer, container package, setup checks, and known limitations.
- Raw setup errors are translated into concrete next actions.

## v0.6.x: Reliable Phone Capture

Goal: make phone capture boringly predictable.

Focus areas:

- ADB authorization diagnostics.
- scrcpy path detection and startup checks.
- OBS bridge readiness and frame freshness.
- One-click capture diagnostics export.
- Clear states for unsupported capture paths.

## v0.7.x: Stronger CV Confidence

Goal: reduce false positives and make model readiness visible.

Focus areas:

- Dataset coverage reporting.
- Calibration UX improvements.
- Confidence gates for draft, minimap, timer, and scoreboard surfaces.
- Clear training/inference runtime status.

## v0.8.x: Polished Tactical Workflows

Goal: make draft, build, and live coaching useful without developer context.

Focus areas:

- Draft workflow ergonomics.
- Build and counter-item recommendations.
- Live reasoning callouts.
- Stream overlay controls.
- Player profile and comfort-pick tuning.

## v0.9.x: Public Beta

Goal: validate the app outside the development machine.

Focus areas:

- Clean-machine install testing.
- Documentation pass.
- Issue templates and support expectations.
- Known limitations page.
- Release checklist.

## v1.0.0: Stable Public Release

Goal: a stable public release with clear supported platforms and limitations.

Minimum bar:

- Download, install, and launch works on supported Windows configurations.
- Core draft/build guidance works without manual developer intervention.
- Setup flow clearly identifies missing capture/CV dependencies.
- Release artifacts and container package are documented.
- Platform support and legal limitations are explicit.
