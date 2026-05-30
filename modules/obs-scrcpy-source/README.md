# OBS scrcpy Device Source

Bundled OBS Studio plugin for MLBB Co-Pilot.

The CV bridge sends latest-frame raw BGRA samples with explicit dimensions and pixel format, so OBS rendering stays realtime even when local CV inference is slower than the phone stream.

The backend installs this bundle automatically into the OBS Studio program plugin directory when OBS Studio is detected:

```text
C:\Program Files\obs-studio\obs-plugins\64bit
C:\Program Files\obs-studio\data\obs-plugins\obs-scrcpy-source
```

OBS must be restarted after install or update before the source appears as `scrcpy Device Source`.
