# Release Checklist

Use this checklist before publishing a public release.

## Pre-Release

- [ ] Confirm `package.json` version.
- [ ] Update [README.md](../README.md) if commands, status, or package tags changed.
- [ ] Update [Roadmap To 1.0.0](roadmap-1.0.md) if milestone status changed.
- [ ] Update [Known Limitations](known-limitations.md) with any new platform or CV caveats.
- [ ] Confirm [NOTICE](../NOTICE) still describes third-party model and asset boundaries accurately.

## Quality Gates

```powershell
npm run install:all
npm run build
npm test
npm run desktop:pack
npm run cv:status
```

Expected result:

- Backend build passes.
- Frontend build passes.
- Test suite passes.
- Electron unpacked build launches.
- First-run setup page reports actionable readiness states.

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
