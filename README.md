# Vibecheck

Codebase health scanner with AI-powered audits and a living architecture visualizer. Scans your code for complexity, dead code, security issues, architectural smells, and more — then renders an interactive dependency graph colored by health.

## Features

**Expanded Module Coverage**
- Static: security vulnerabilities, outdated deps, complexity, dead code, circular deps, test coverage, compliance rules, custom AST patterns, config quality, secrets scanning, type safety, telemetry/observability
- Deterministic execution checks: build, lint, typecheck, and test command verification when the repo exposes them
- Runtime: live API endpoint testing (crashes, missing validation, slow responses)
- AI-powered: naming quality, documentation staleness, architectural smells, test quality, doc accuracy, error handling, and context conflicts

**Architecture Visualizer**
- Interactive force-directed dependency graph (Sigma.js + WebGL)
- Nodes colored red/yellow/green by health score
- Louvain community detection for automatic feature area clustering
- Blast radius mode — click a file, see everything that depends on it
- Layer violation detection (UI importing from Data, etc.)
- Time slider — scrub through scan history and watch health evolve
- Filter by health, architectural layer, or text search

**Project Profiles**
- Archetypes: Web App, API Service, Library, CLI, Agent Tooling, Prototype, and Compliance Sensitive
- Legacy `solo`, `team`, and `enterprise` config values still normalize to the newer archetypes
- Auto-adjust scoring thresholds and module enables per repo shape

**Scan Tiers**
- Pro (Haiku, sampled), Max (Sonnet, full), Max x20 (Sonnet + Opus verify), API (token-budgeted)

**Cross-Model Audits**
- Run the same audit with Claude API, Claude CLI, and Codex
- Compare findings across models

## Quick Start

```bash
# Scan a repo (opens browser dashboard)
npx vibecheck /path/to/your/project

# Headless — generate a Claude prompt from findings
npx vibecheck /path/to/your/project --prompt

# Headless — JSON output with pass/fail threshold
npx vibecheck /path/to/your/project --json --threshold 70
```

## Dashboard

The web UI shows:
- **Dashboard** — all registered repos with health scores and profile badges
- **Repo Detail** — findings table, module scores, hotspot quadrant, trend charts
- **Architecture Map** — interactive codebase graph with health overlay
- **Scan Comparison** — side-by-side score deltas between scans
- **Trends** — score history over time, finding status evolution
- **AI Audit** — per-module AI analysis results with cross-model comparison
- **Settings** — profile/tier selection, AI provider config, module toggles

## MCP Integration

Use vibecheck as an MCP tool server in Claude Code:

```json
{
  "mcpServers": {
    "vibecheck": {
      "command": "npx",
      "args": ["tsx", "./mcp-server/index.ts"]
    }
  }
}
```

Tools: `vibecheck_scan`, `vibecheck_health`, `vibecheck_module`, `vibecheck_compare`, `vibecheck_prompt`, `vibecheck_next_actions`, `vibecheck_findings`, `vibecheck_settings`

## Configuration

### Per-repo: `.vibecheckrc`

```json
{
  "profile": "prototype",
  "tier": "max",
  "modules": { "git-health": false },
  "thresholds": { "complexity": 80 },
  "ignore": ["generated/**"],
  "classify": { "lib/sdk/index.ts": "public-api" },
  "aiTokenBudget": 50000
}
```

### Global: `~/.vibecheck/config.json`

```json
{
  "scanDirs": ["/home/user/projects"],
  "tier": "max",
  "profile": "web-app"
}
```

## Supported Languages

Static modules are JS/TS-focused (complexity, dead-code, circular-deps). AI audits and file scanning support: TypeScript, JavaScript, Go, Python, Rust, Java, Kotlin, Ruby, Swift, C/C++, C#, PHP, Lua, Zig.

## Tech Stack

- Next.js 16, React 19, TypeScript 5
- SQLite via drizzle-orm + better-sqlite3
- Sigma.js 3 + graphology (WebGL graph visualization)
- Anthropic SDK (Claude API/CLI/Codex)
- Tailwind CSS 4, shadcn/ui
- ts-morph, knip, dependency-cruiser, ast-grep, gitlog

## Development

```bash
npm install
npm run dev          # Start dev server on :3000
npm test             # Fast local contract + policy tests
npm run build        # Production build
npm run db:generate  # Generate drizzle migrations
npm run db:migrate   # Apply migrations
npm run db:studio    # Open drizzle studio
```

## License

MIT
