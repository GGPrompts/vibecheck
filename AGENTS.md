# Vibecheck Agent Guide

## What This Repo Is

Vibecheck is a local-first codebase health scanner with three entry points:

- `bin/` contains the CLI (`vibecheck`) and headless helpers.
- `app/` contains the Next.js 16 dashboard and API routes.
- `mcp-server/` exposes Vibecheck as MCP tools.

Core analysis and reporting logic lives in `lib/`. Prefer extending shared `lib/` code over duplicating logic inside route handlers or UI components.

## Stack And Constraints

- Next.js `16.2.1` with App Router
- React `19.2.4`
- TypeScript `5`
- Tailwind CSS `4`
- SQLite via `better-sqlite3` and `drizzle-orm`

This project is intentionally using a newer Next.js release than many agents expect. Follow the codebase's existing patterns instead of older Next.js habits.

## Next.js Conventions Used Here

- Dynamic page props and route handler params use the async form:
  - `params: Promise<{ id: string }>`
  - await `params` before reading values
- Route handlers live under `app/api/**/route.ts` and generally return `NextResponse.json(...)`.
- The app uses native server packages in `next.config.ts`:
  - `@ast-grep/napi`
  - `better-sqlite3`
- Do not assume edge-compatible code. Many server paths depend on Node APIs and local filesystem access.

## Important Project Paths

- `app/`: pages, layouts, route handlers
- `components/`: UI and visualization components
- `lib/`: scanner, config, GitHub helpers, reporting, prompts, modules
- `bin/`: CLI entrypoints
- `mcp-server/`: MCP tool server
- `docs/portability.md`: notes on keeping the app embeddable

## Data And Config Locations

Vibecheck stores state outside the repo:

- SQLite DB: `~/.vibecheck/vibecheck.db`
- Global settings: `~/.vibecheck/config.json`
- Per-repo config: `.vibecheckrc`

Be careful when changing config or schema behavior. The CLI, web app, and MCP server all depend on the same local data model.

## Working Rules For Agents

- Read the existing implementation before changing framework patterns. This repo already shows the expected Next.js 16 signatures.
- Prefer shared library changes in `lib/` when behavior is used by more than one surface.
- Keep API routes thin when possible; push scanning, settings, reporting, and graph logic into `lib/`.
- Preserve the local-first model. Do not introduce mandatory hosted services or assume network access.
- Use `npm`, not `pnpm` or `yarn`, unless the repo is explicitly changed to another package manager.
- Be careful with native and heavy dependencies such as `better-sqlite3`, `@ast-grep/napi`, graph tooling, and visualization packages.

## Useful Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
node bin/vibecheck.mjs /path/to/repo --no-open
node bin/vibecheck.mjs /path/to/repo --json
```

Run `npm test` for fast policy and MCP contract coverage after behavioral changes when practical. Run `npm run lint` after code changes when practical. Run `npm run build` as a higher-confidence check for routing, typing, and bundling changes.

## Practical Editing Guidance

- If you touch dynamic routes or route handlers, keep the existing `Promise`-based `params` typing unless you verify the project has migrated away from it everywhere.
- If you touch persistence, inspect both the CLI path in `bin/vibecheck.mjs` and the app/server code in `lib/db` and `app/api`.
- If you add a feature that belongs in the CLI, UI, and MCP surfaces, design the shared logic once in `lib/` and wire each surface to it.
- If you see generic framework instructions that conflict with the code in this repo, trust the repo.
