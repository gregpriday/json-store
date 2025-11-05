# Repository Guidelines

## Project Structure & Module Organization
JSON Store is a pnpm-managed monorepo:
- `packages/sdk/src` — core store, Mango query engine, formatting, and atomic file I/O.
- `packages/cli/src` — CLI layer translating SDK workflows for humans.
- `packages/server/src` — MCP server exposing the same tools to agents.
- `packages/testkit/src` — fixtures and subprocess helpers shared across suites.
Docs live in `docs/`, demos in `examples/`, and tests live in `packages/*/test` or colocated `src/**/*.test.ts`. Build artifacts stay in each package `dist/`.

## Build, Test & Development Commands
- `pnpm install` — install workspace dependencies (pnpm ≥8).
- `pnpm build` — compile every package via TS project references.
- `pnpm test` — run Vitest suites; combine with `--filter <pkg>` for one workspace.
- `pnpm lint` / `pnpm format` — apply ESLint and Prettier defaults before commits.
- `pnpm typecheck` — verify declaration output stays healthy.

## Coding Style & TypeScript Conventions
The repo uses strict TypeScript (NodeNext ESM). Keep `.js` extensions on relative imports so emitted modules resolve. Prettier enforces 2-space indentation, semicolons, double quotes, and `printWidth: 100`. ESLint expects camelCase for values, PascalCase for classes, and `_` prefixes on intentionally unused identifiers. New CLI commands belong under `packages/cli/src/commands/`.

## Testing Guidelines
Vitest is the canonical harness. Name test files `*.test.ts`, colocate unit suites when practical, and reserve `packages/cli/test` for higher-level flows. Reach for `@jsonstore/testkit` when spawning subprocesses or creating fixtures. Enable performance checks only when needed: `VITEST_PERF=1 pnpm --filter @jsonstore/sdk test`.

## Core Architecture & Patterns
Data lives in `data/<type>/<id>.json` with deterministic key ordering for clean diffs. Writes go through `atomicWrite()` (temp file + rename) and path sanitization prevents traversal. The `DocumentCache` validates entries by mtime and size, evicting after writes; disable via `JSONSTORE_CACHE_SIZE=0`. Optional equality indexes appear in `data/<type>/_indexes/` and are built on demand.

## Git & Pull Request Flow
Primary branches are `main` and `develop`. Follow Conventional Commits (`feat(sdk): add slug support`), scope changes to one package when feasible, and update related docs in the same patch. Before opening a PR, run `pnpm lint`, `pnpm test`, and required builds, then share results, reference linked issues, and flag breaking changes. Include CLI output or screenshots when behavior shifts and request review from the maintainer covering the affected package.

## Agent Notes
Automations should touch `src/`, never generated `dist/`. Use `pnpm --filter` to narrow workspace operations, and update CLI help plus docs whenever introducing new commands or APIs.
