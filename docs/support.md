# Support Guide

Use GitHub Issues for support so fixes and diagnostics stay searchable.

## Before Opening An Issue

Check:

- [Installing MLBB Co-Pilot](installing-mlbb-copilot.md)
- [Known Limitations](known-limitations.md)
- [Roadmap To 1.0.0](roadmap-1.0.md)

Run the basic checks:

```powershell
npm run build
npm test
npm run cv:status
```

For capture problems:

```powershell
adb devices -l
scrcpy --version
```

## What To Include

Include:

- MLBB Co-Pilot version or commit.
- Windows version and hardware summary.
- Node.js version.
- Whether you are using source dev mode, Electron, or container mode.
- Exact command that failed.
- Relevant terminal output.
- Capture source: ADB, scrcpy, OBS, manual mode, or none.
- CV runtime mode: CPU, DirectML, CUDA, WSL ROCm, or unknown.

Do not include:

- Authorization headers.
- Account tokens.
- Private gameplay footage.
- Private screenshots.
- Raw downloaded game assets unless you have permission to share them.

## Security Issues

Follow [SECURITY.md](../SECURITY.md). Do not disclose vulnerability details in a public issue.
