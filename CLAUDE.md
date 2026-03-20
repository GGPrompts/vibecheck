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
- **Profiles** — Project type presets (solo/team/library/prototype/enterprise) that adjust module enables + thresholds. Defined in `lib/config/profiles.ts`.
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
```

## Folder Docs

Each major directory has its own CLAUDE.md with implementation details:
- `mcp-server/CLAUDE.md` — MCP tool definitions and usage
- `lib/modules/CLAUDE.md` — Module system, how to add new modules
- `lib/visualizer/CLAUDE.md` — Architecture visualizer data layer
- `lib/ai/CLAUDE.md` — AI providers and audit system
