# Repository Audit — 2026-08-19

## Scope

Audited the current monorepo state for build health, automated test health, documentation accuracy, and dependency-audit accessibility. The project is an npm-workspaces application with a NestJS/Prisma API under `apps/api` and a React/Vite web app under `apps/web`.

## Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run prisma:generate` | Pass | Required before TypeScript/Jest because generated Prisma enums and model types are consumed throughout the API. |
| `npm run typecheck` | Pass | API and web TypeScript projects compile with `--noEmit`. |
| `npm run lint` | Pass | ESLint completed with zero warnings/errors. |
| `npm test` | Pass | API Jest suite and web Node test suite passed. |
| `npm run build` | Pass | Nest API and Vite web production builds completed. |
| `npm audit --audit-level=moderate` | Blocked | npm registry audit endpoint returned HTTP 403 in this environment, so vulnerability status could not be verified here. |

## Findings

1. **Generated Prisma client is a prerequisite.** A fresh checkout without a generated Prisma client fails type-checking and API Jest tests with missing Prisma exports/enums. Running `npm run prisma:generate` resolves this for the current schema and installed dependencies.
2. **Documentation drift existed in `SETUP.md`.** The setup guide still described the repository as documentation-only Stage 1, while the codebase and README show implementation through later stages. This audit updates that status note to avoid misleading contributors.
3. **npm configuration warning is present.** Commands print `npm warn Unknown env config "http-proxy"`; it does not currently fail lint/typecheck/test/build, but the environment or npm config should be cleaned up before relying on future npm major versions.
4. **Security audit could not be completed from this runner.** Re-run `npm audit --audit-level=moderate` from an environment with registry audit access before release.

## Recommendations

- Document `npm run prisma:generate` as an explicit first verification step for fresh checkouts and CI cache restores.
- Add a CI job step that runs Prisma generation before type-checking/tests if it is not already guaranteed by the pipeline.
- Re-run npm audit in a network/registry-authorized environment and triage any reported moderate-or-higher advisories.
- Consider moving Prisma config out of `package.json#prisma` before Prisma 7, based on the deprecation warning emitted during generation.
