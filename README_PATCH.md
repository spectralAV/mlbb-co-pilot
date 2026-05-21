# MLBB Co-Pilot Single Terminal Runtime Patch

Apply this patch to the root folder of your clean project:

```text
C:\MLBB-Co-Pilot
```

## Install once

```powershell
cd C:\MLBB-Co-Pilot
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Daily start

```powershell
npm run dev
```

or:

```powershell
.\start.ps1
```

This starts backend and frontend together in one terminal.
