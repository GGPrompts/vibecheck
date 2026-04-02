@AGENTS.md

# Vibecheck

Codebase health scanner and living architecture visualizer. Combines static analysis, AI-powered audits, and interactive dependency graphs to give a complete picture of code quality.

## Architecture

```
CLI (bin/vibecheck.mjs)
  |
  v
Module Orchestrator (lib/modules/orchestrator.ts)
  |-- Static modules: security, dependencies, complexity, git-health,
  |                    dead-code, circular-deps, test-coverage,
  |                    compliance, ast-rules, api-health,
  |                    build, lint, typecheck, test,
  |                    type-safety, secrets-scan, config-quality
  |-- AI modules:     naming-quality, doc-staleness, arch-smells, test-quality,
  |                    doc-accuracy, context-conflicts, error-handling
  |
  v
SQLite DB (drizzle-orm + better-sqlite3)
  |-- repos, scans, moduleResults, findings
  |-- audits, auditResults, prompts, scanConfigs
  |
  v
Next.js 16 App (app/)
  |-- Dashboard (/dashboard)
  |-- Repo detail (/repo/[id]) — findings, trends, comparison, audit
  |-- Architecture map (/repo/[id]/map) — Sigma.js + graphology
  |-- Settings (/settings) — profiles, tiers, AI provider
  |
  v
MCP Server (mcp-server/) — 4 tools for Claude Code integration
```

## Key Concepts

- **Modules** — 20 analysis modules (static + AI). Each has `canRun()`, `run()`, returns score 0-100 with findings. Registered in `lib/modules/register-all.ts`.
- **Profiles** — Repo archetypes (`web-app`, `api-service`, `library`, `cli`, `agent-tooling`, `prototype`, `compliance-sensitive`) with auto-detect plus manual override. Legacy `solo`, `team`, and `enterprise` values normalize to `prototype`, `web-app`, and `compliance-sensitive`. Defined in `lib/config/profiles.ts`.
- **Tiers** — Scan depth presets (pro/max/max-x20/api) controlling model selection, parallelism, and coverage. Defined in `lib/config/tiers.ts`.
- **File Roles** — Auto-detected file classifications (api-route, ui-kit, barrel-file, etc.) that adjust scoring per module. Built by `lib/metadata/classifier.ts`.
- **Findings** — Individual issues found by modules, tracked across scans with fingerprinting (new/recurring/fixed/regressed).
- **.vibecheckrc** — Per-repo config for modules, thresholds, ignore patterns, profiles, tiers, classify overrides. Schema in `lib/config/vibecheckrc.ts`.

## Tech Stack

- **Next.js 16** with App Router (route handlers use `params: Promise<{}>` pattern)
- **SQLite** via drizzle-orm + better-sqlite3, stored at `~/.vibecheck/vibecheck.db`
- **Sigma.js 3** + graphology for WebGL architecture visualization
- **Anthropic SDK** for AI modules + audits (supports Claude API, CLI, Codex)
- **Tailwind CSS 4** for styling, shadcn/ui components
- **ts-morph** for AST analysis, **knip** for dead code, **dependency-cruiser** for circular deps

## Database

SQLite at `~/.vibecheck/vibecheck.db`. Auto-migrates on startup. Schema in `lib/db/schema.ts`, migrations in `lib/db/migrations/`. 8 tables: repos, scans, moduleResults, findings, scanConfigs, audits, auditResults, prompts.

## Config Hierarchy

Repo-level `.vibecheckrc` overrides global `~/.vibecheck/config.json`. Profile config is applied first as a base, then explicit overrides on top.

## Conventions

- API routes follow Next.js 16 pattern: `export async function GET(req, { params }: { params: Promise<{ id: string }> })`
- All IDs are nanoid-generated strings
- Findings are fingerprinted for dedup across scans
- AI modules require `ANTHROPIC_API_KEY` env var
- Module results include `confidence` (0.0-1.0) alongside `score` (0-100)
- Module results also carry execution state metadata: `completed`, `not_applicable`, `insufficient_evidence`, `skipped`, or `unavailable`
- `canRun() === false` should be persisted as `not_applicable` instead of disappearing from scan output
- Deterministic execution checks now live in the module system as `build`, `lint`, `typecheck`, and `test`; if the project does not expose a command, the module should stay neutral via `not_applicable`
- Archetype auto-detect uses repo-shape heuristics such as `app/api` or `pages/api` for service shape, `bin` or `package.json#bin` for CLI shape, package entry exports for library shape, deploy files plus long-running scripts for deployable services, and `mcp-server` or prompt/agent directories for agent-tooling

## Running

```bash
# Interactive (opens browser)
npx vibecheck /path/to/repo

# Headless — output Claude prompt
npx vibecheck /path/to/repo --prompt

# Headless — output JSON
npx vibecheck /path/to/repo --json --threshold 70

# Dev server only
npm run dev

# Fast local tests
npm test
```

## Test Harness

- Unit tests use Node's built-in `node:test` runner with `tsx` as the TypeScript loader.
- Keep new fixtures deterministic and filesystem-local; avoid DB or network setup unless the contract under test genuinely requires it.
- For MCP payload checks, prefer exporting a small pure payload builder over stubbing live DB helpers.

## Portability

This project is designed to eventually be embeddable as a section in personal-homepage. Key principles: thin API routes over fat lib functions, props-driven components, lazy-loaded heavy deps (Sigma.js, Nivo), SQLite as single source of truth. See `docs/portability.md` for the full guide and checklist.

## Folder Docs

Each major directory has its own CLAUDE.md with implementation details:
- `docs/portability.md` — Guide for embedding VibeCheck in other apps
- `mcp-server/CLAUDE.md` — MCP tool definitions and usage
- `lib/modules/CLAUDE.md` — Module system, how to add new modules
- `lib/visualizer/CLAUDE.md` — Architecture visualizer data layer
- `lib/ai/CLAUDE.md` — AI providers and audit system
