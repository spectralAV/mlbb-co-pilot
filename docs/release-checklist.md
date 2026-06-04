# Release Checklist

Use this checklist before publishing a public release.

## Pre-Release

- [ ] Confirm `package.json` version.
- [ ] Update [README.md](../README.md) if commands, status, or package tags changed.
- [ ] Update [Roadmap To 1.0.0](roadmap-1.0.md) if milestone status changed.
- [ ] Check [Next Version Roadmap](roadmap-next-version.md) success criteria for `v0.5.0-desktop-alpha`.
- [ ] Update [Known Limitations](known-limitations.md) with any new platform or CV caveats.
- [ ] Confirm [NOTICE](../NOTICE) still describes third-party model and asset boundaries accurately.

## Quality Gates

```powershell
npm run release:gate
```

Or step by step:

```powershell
npm run install:all
npm run build
npm test
npm run desktop:pack
npm run cv:status
npm run cv:wsl:status
```

Expected result:

- Backend build passes.
- Frontend build passes.
- Test suite passes.
- Electron unpacked build launches.
- First-run setup page reports actionable readiness states.

**Important:** Run `npm run build` before `npm run desktop:dist` or `desktop:pack`. The Electron bundle copies prebuilt `backend/dist` and `frontend/dist`; skipping build ships stale training/coach code.

### Maintainer CV / training matrix (Windows + WSL ROCm)

Documented in [data/cv/README.md](../data/cv/README.md#training-job-lifecycle-wsl). Before tagging:

- [ ] One train start → stop mid-epoch (job API, WSL PIDs cleared).
- [ ] Optional: backend restart during train → rehydrated status + stop works.
- [ ] `rg "7242|debug-session|624fbe|#region agent" backend/src frontend/src` returns no release-blockers.
- [ ] Copy [`.env.example`](../.env.example) to `.env` for local secrets (never commit `.env`).
- [ ] One DirectML infer smoke: `npm run cv:status` shows `modelAvailable: true`.

Near-term milestone doc: [roadmap-next-version.md](roadmap-next-version.md).

## Desktop Package

- [ ] App icon appears in the packaged app.
- [ ] Product name is `MLBB Co-Pilot`.
- [ ] Backend starts as a managed local process.
- [ ] `/api/health` becomes ready before the frontend loads.
- [ ] Setup page loads inside the desktop shell.
- [ ] Installer output is smoke-tested on a clean Windows machine when possible.

## Container Package

- [ ] Tag follows `mobile-legends-vX.Y.Z`.
- [ ] `publish-container.yml` completes successfully.
- [ ] GHCR image tags are present:
  - `latest`
  - `X.Y.Z`
  - `mobile-legends-vX.Y.Z`
- [ ] Container starts locally with `docker run --rm -p 8787:8787 ghcr.io/spectralav/mlbb-co-pilot:latest`.

## GitHub Release

- [ ] Release title is clear.
- [ ] Notes include status, install path, package tags, and known limitations.
- [ ] Any installer or generated artifact is attached only if it has been tested.
- [ ] Release notes link to support and security docs.
