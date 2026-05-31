# Known Limitations

MLBB Co-Pilot is currently a public alpha. The project is useful for local testing and iteration, but it is not yet a stable `1.0.0` release.

## Platform Support

- Windows is the primary supported development and desktop packaging path.
- macOS and Linux Electron targets are configured, but ADB, scrcpy, Python, CV runtime, and installer behavior still need platform-specific QA.
- The container package serves the web runtime. It is not a full replacement for the Electron desktop shell or phone capture stack.

## Capture And CV

- Phone capture depends on local ADB authorization, scrcpy availability, device permissions, and USB/network stability.
- OBS integration depends on local OBS configuration and source freshness.
- CV accuracy depends on screen resolution, UI language, device aspect ratio, graphics settings, dataset coverage, and calibration quality.
- CV should adapt to device differences through normalized ROIs, dynamic UI anchors, aspect-ratio profiles, calibration fallback, confidence gates, and manual override. Separate production models per device or screen size are out of scope.
- DirectML is the preferred Windows AMD inference path today. WSL ROCm training is experimental and can stress the Windows display driver on some hardware.
- OCR is optional and should be treated as a sidecar helper, not the source of truth for match-state decisions.

## Data And Licensing

- MLBB Co-Pilot does not relicense Mobile Legends: Bang Bang names, artwork, screenshots, icons, or extracted/cached data.
- Third-party models, datasets, and runtimes retain their upstream license terms.
- Do not commit private captures, downloaded game assets, auth headers, or generated model weights.

## Product Scope

- The app is a local tactical assistant, not gameplay automation.
- The app does not bypass game protections.
- Recommendations are advisory and may be wrong when live data is incomplete, stale, or low-confidence.

## Release Readiness

Before `1.0.0`, the project still needs:

- Clean Windows installer validation.
- Stronger first-run setup guidance.
- Reliable capture diagnostics.
- CV confidence reporting and calibration UX.
- Public beta testing on clean machines.
