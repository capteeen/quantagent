# Rules for every build agent (from SPEC.md §1)

- Write only inside your owned directory plus your tests.
- Package name is `@quantagent/<dir>`; export a typed public API from `src/index.ts`, documented in `README.md`.
- Shared types: import from `@quantagent/core/types` (file: packages/core/types/index.ts, clients.ts). Do not duplicate them. If you need a new shared type, add it to a `types/` file in your package and tell the integrator.
- Never stub, fake or hardcode a value the spec says must be produced. If a capability needs a key or an external repo that is not present, throw `NotImplemented(capability, because, needs[])` from `@quantagent/core/types` with the exact env var names. No mock coins, posts, images, workers or seeded data. Empty states render empty.
- "Done" means `pnpm --filter @quantagent/<dir> test` and `typecheck` pass.
- Every package: `package.json` (type: module, exports, scripts build/test/typecheck), `tsconfig.json` extending `../../tsconfig.base.json`, tests with vitest.
- Env vars: read via `process.env`, list every one you read in your README under "Environment".
- Do not install packages outside your own package. Run `pnpm install` from the repo root only once if you need to; use `--offline` retries if the registry is flaky.
