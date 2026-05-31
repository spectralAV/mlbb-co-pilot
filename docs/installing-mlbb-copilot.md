# Installing MLBB Co-Pilot

This tutorial installs MLBB Co-Pilot as a local development tool and, optionally, runs the Electron desktop shell.

## 1. Install Prerequisites

Install these first:

- Node.js 22 LTS or newer
- Git, if you are cloning the project
- PowerShell 7 or Windows PowerShell
- Python 3, only if you plan to use CV tooling directly
- ADB and scrcpy, only if you plan to capture a phone screen

On Windows, the project can also detect `adb.exe`, `scrcpy.exe`, and `scrcpy-server` from:

```text
C:\Users\<you>\Downloads\scrcpy-win64-v4.0
```

## 2. Open The Project Folder

```powershell
cd "C:\Users\<you>\Documents\MLBB CoPilot"
```

If PowerShell blocks local scripts for the current terminal session, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## 3. Install Dependencies

Install root, backend, and frontend packages:

```powershell
npm run install:all
```

This creates:

- `node_modules`
- `backend/node_modules`
- `frontend/node_modules`

## 4. Start The Web Tool

Run the local web app:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173
```

Check the backend:

```text
http://localhost:8787/api/health
```

If the health endpoint returns `ok: true`, the tool is running.

## 5. Run The Desktop Shell

For desktop development, run:

```powershell
npm run desktop:dev
```

This starts the backend, frontend, and Electron window together.

To run the built Electron shell:

```powershell
npm run desktop
```

## 6. Build A Local Desktop Package

Create an unpacked desktop build for local testing:

```powershell
npm run desktop:pack
```

The Windows build appears at:

```text
dist-electron\win-unpacked\MLBB Co-Pilot.exe
```

Create an installer or platform package:

```powershell
npm run desktop:dist
```

Windows packaging is the current primary path. macOS and Linux targets are configured, but still need platform-specific QA for ADB, scrcpy, Python, and CV runtime setup.

## 7. Optional: Check CV Runtime

Check whether the local YOLO runtime is ready:

```powershell
npm run cv:status
```

Prepare or refresh the local dataset:

```powershell
npm run cv:bootstrap
```

## 8. Optional: Use Friendly Local URLs

Install local DNS entries from an elevated PowerShell:

```powershell
npm run local-dns:install
```

Then start the local proxy mode:

```powershell
npm run dev:local
```

Open:

```text
http://mlbb.local
```

## Troubleshooting

If `npm run dev` fails, check that no other app is using ports `5173` or `8787`.

If Electron opens but the app stays blank, run:

```powershell
npm run build
npm run desktop
```

If phone capture fails, confirm the device is authorized:

```powershell
adb devices -l
```

If scrcpy capture fails, confirm scrcpy can run by itself:

```powershell
scrcpy --version
```

If CV status fails, make sure Python is installed and run:

```powershell
npm run cv:status
```
