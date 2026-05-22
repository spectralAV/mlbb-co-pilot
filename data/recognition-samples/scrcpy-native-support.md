# scrcpy Native Support

MLBB Co-Pilot can use `genymobile/scrcpy` as a native Android mirror source.

## Current Integration

- License: Apache-2.0 upstream.
- Local binary detection:
  - `SCRCPY_PATH`
  - `scrcpy` on `PATH`
  - `Downloads/scrcpy-win64-v4.0/scrcpy.exe`
- Backend endpoints:
  - `GET /api/capture/scrcpy/status`
  - `POST /api/capture/scrcpy/start`
  - `POST /api/capture/scrcpy/stop`
- Frontend source: `Backend scrcpy`

The current app starts and manages scrcpy as a native external process. This is the practical first step before deeper frame decoding. The next step is to consume scrcpy's socket/video stream directly in the backend and publish decoded native-resolution frames into the unified capture runtime.

## Default Launch Options

- H.264 video codec
- 60 FPS target
- 16M video bitrate
- no audio
- stay-awake
- no local scrcpy window by default

This keeps latency low and avoids browser screen-share permission issues.

## Background Mode

The managed source starts scrcpy with `--no-window` by default. That prevents the mirror window from jumping to the foreground or being scaled by the desktop display. A visible mirror can still be launched by posting `{ "background": false }` to `/api/capture/scrcpy/start`.

This background launch is separate from full backend frame decoding. Direct scrcpy video-stream decoding is still the next deeper integration step for high-FPS CV frames.
