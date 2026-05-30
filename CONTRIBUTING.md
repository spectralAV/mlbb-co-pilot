# Contributing To MLBB Co-Pilot

Thanks for helping make MLBB Co-Pilot better. This project is still in public alpha, so the most useful contributions are focused, reproducible, and easy to verify.

## Development Setup

Install dependencies:

```powershell
npm run install:all
```

Start the local app:

```powershell
npm run dev
```

Run quality checks before opening a pull request:

```powershell
npm run build
npm test
```

For desktop packaging checks:

```powershell
npm run desktop:pack
```

## Contribution Workflow

1. Open or find an issue that describes the problem.
2. Keep changes scoped to one topic.
3. Prefer existing patterns in the backend, frontend, CV tools, and docs.
4. Add or update tests when behavior changes.
5. Update documentation when setup, commands, platform support, or user-facing behavior changes.
6. Open a pull request with a clear summary and verification notes.

## Code Style

- TypeScript is used for the backend, frontend, tests, and shared app logic.
- Keep UI changes consistent with the existing React/Vite/Tailwind structure.
- Keep backend changes inside the existing Fastify route, service, engine, and vision boundaries.
- Prefer structured data files and parsers over ad hoc string parsing.
- Keep comments short and useful.

## CV And Data Boundaries

- Do not commit private gameplay recordings, raw captures, auth tokens, downloaded proprietary data, or generated model weights.
- Do not bypass game protections or automate gameplay.
- Keep training datasets, extracted assets, and cached third-party data under the ignored `data/` paths unless a maintainer explicitly approves a small fixture.
- Note any third-party dataset, model, or runtime license in the pull request.

## Pull Request Checklist

- [ ] The change has a clear user or maintainer benefit.
- [ ] `npm run build` passes.
- [ ] `npm test` passes, or the reason it could not run is explained.
- [ ] Docs are updated when behavior or setup changes.
- [ ] No secrets, tokens, private logs, raw recordings, or unlicensed assets are included.
- [ ] Legal and platform limitations are not weakened or hidden.
