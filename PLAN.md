# Vibecheck — Codebase Health Dashboard

## Context

A local-first codebase health dashboard for Claude Code power users. Point it at any repo and get a visual overview of complexity, security, dead code, dependency health, and AI-powered qualitative analysis — all with scores, confidence levels, and trend tracking over time.

The core differentiator: **prompt targeting.** Vibecheck doesn't just show you what's wrong — it generates ready-to-paste Claude Code instructions from scan findings, so you know exactly what to tell Claude to fix. Without this, it's just another static analysis dashboard.

Born from FixReady's scanning/dashboard architecture but pivoted from "accessibility SaaS" to "general-purpose codebase health tool." No auth, no billing, no cloud dependencies (except optional Claude API for AI modules).

---

## Competitive Landscape

Research conducted March 2026. The space has many tools but none combine all of vibecheck's dimensions.

### Direct competitors

| Tool | What it does | Local? | Gap vibecheck fills |
|------|-------------|--------|-------------------|
| **CodeScene** | Behavioral code analysis, hotspots, team coupling. Gold standard for enterprise. MCP server is OSS | Cloud SaaS + self-hosted enterprise. MCP server is local | Enterprise-priced, not designed for solo dev quick scans. MCP server is code-health only — no security, dead code, deps |
| **CodeCharta** | 3D city-metaphor visualization (height=complexity, area=LOC). Imports from SonarQube, Tokei, etc. | Fully local, free, OSS | Requires importing from other tools first (not self-contained). Impressive viz but not actionable — no prompts, no security |
| **Drift** (Go, marquiscodes) | Dead functions, import boundaries, dep freshness, health over last 10 commits. `drift fix` calls Copilot CLI | Local CLI + browser dashboard, free, OSS | Full AST only for Go; other langs get heuristics. Relies on Copilot CLI. No security scanning |
| **Drift** (Rust, dadbodgeoff) | Codebase intelligence for AI. 50+ MCP tools, call graph, boundary detection, coupling analysis. Tree-sitter | Fully local, free, OSS | Focused on giving AI agents context, not developers a visual dashboard. No health scoring, no security |
| **Butter Code Health** | Wraps ESLint + dependency-cruiser + knip + cloc. Browser dashboard. Exposes MCP server | Fully local, free, OSS | JS/TS only. Dashboard requires running server. Wrapper, not unified scoring. No security |
| **Nikui** | LLM + Semgrep + duplication + git churn → prioritized hotspot quadrants (Toxic/Frozen/Quick Win/Healthy) | Local CLI, free, OSS | CLI only — no dashboard, no trend tracking, no multi-repo. But its quadrant model is worth adopting |
| **Code Health Meter** | Six-dimensional static analysis (Maintainability Index, Cyclomatic, Duplication, Modularity, Centrality, Coupling) | Local CLI, free, OSS | JS/TS only, CLI output only, no security/deps/dead code. Academically rigorous but not actionable |
| **Endure** | Predictive code maintenance intelligence. Scores files by complexity, churn, staleness, historical risk | Cloud only, free preview | Cloud-only. No security, deps, dead code. No prompts |

### Claude Code ecosystem tools (not competitors — different category)

| Tool | What it does | Overlap with vibecheck |
|------|-------------|----------------------|
| **Claudia GUI** | Session management, usage analytics, cost tracking for Claude Code | Tracks Claude usage, not codebase health. Zero overlap |
| **claude-code-analytics** | Captures conversations via SessionEnd hook, Streamlit dashboard | Analyzes conversations, not code. Zero overlap |
| **SigNoz Claude Dashboard** | Monitoring template for Claude Code API usage patterns | Operational monitoring, not code quality. Zero overlap |

### Prompt generation tools (the gap vibecheck fills)

| Tool | What it does | Gap |
|------|-------------|-----|
| **Vibe Check CLI** (vibe-check.cloud) | Scans AI-generated codebases across 6 domains, generates paste-ready prompts | Closest competitor for prompt generation. But: focused on "vibe-coded" apps only, no complexity/dead code/deps. More of a production-readiness checklist |
| **codebase-digest** | Packs codebases into AI-friendly format with 60+ pre-built analysis prompts | Context packer with prompt templates — doesn't run analysis itself |
| **VibeCheck** (copyleftdev, Zig) | Pattern-matching for TODOs, secrets, debug prints. Has MCP server | Surface-level pattern matching only, no AST analysis |

### Key gaps in the market

1. **No tool combines all dimensions in one scan** — complexity + security + dead code + deps + git health + actionable prompts
2. **No tool is a "pre-flight check" for AI coding sessions** — tools either analyze code OR help AI understand code, never both
3. **Prompt generation from analysis is nearly empty** — Vibe Check CLI is the only real entrant and it's narrowly focused
4. **Local-first + multi-repo + visual dashboard is rare** — most local tools are CLI-only; most dashboards are cloud SaaS
5. **Language-agnostic analysis is uncommon** — most local tools are JS/TS only

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (stable) | Carry over from fixready. Pin to stable — fall back from 16/Turbopack if build issues arise, this architecture doesn't depend on bleeding-edge features |
| UI | shadcn/ui + Tailwind + **Nivo** (primary charts) + Recharts (simple charts) | Nivo for treemaps, radar charts, heatmaps with beautiful defaults. Recharts for simple trend lines. react-force-graph for dependency graph viz |
| Local DB | SQLite via better-sqlite3 + Drizzle ORM | No Docker/server needed, single file DB at `~/.vibecheck/vibecheck.db`. Stick with better-sqlite3 over bun:sqlite — it's battle-tested and Bun isn't the target runtime |
| Job processing | In-process async + SSE progress | No Redis/BullMQ needed for single-user local tool |
| AI | @anthropic-ai/sdk (Sonnet default, Opus for arch analysis) | Same model routing pattern as fixready |
| Static analysis | Language-agnostic where possible (see module table) | Existing CLI tools wrapped as modules |

---

## Module Architecture

Every health dimension is a **module** implementing a common interface:

```
ModuleRunner.canRun(repoPath) → boolean   // can this module analyze this repo?
ModuleRunner.run(repoPath, opts) → ModuleResult
  → score: 0-100
  → confidence: 0.0-1.0 (1.0 for static, variable for AI)
  → findings: Finding[] (each with fingerprint for cross-scan tracking)
  → metrics: Record<string, number> (for trend charts)
```

Modules register in a central registry. The orchestrator runs all enabled modules, aggregates scores, and streams progress via SSE.

### Static Modules (deterministic, no AI cost)

| Module | Tool | What it measures | Language support |
|--------|------|-----------------|-----------------|
| **complexity** | rust-code-analysis (primary, REST API) + ts-morph (JS/TS detail) | File lengths, function counts, cyclomatic complexity, cognitive complexity, Halstead metrics, maintainability index | Any (rust-code-analysis supports 20+ languages via tree-sitter); ts-morph adds JS/TS-specific AST detail. Fallback: lizard (30+ languages, Python subprocess) |
| **security** | `npm audit --json` + trivy | Known vulnerabilities by severity | JS/TS via npm audit; trivy for containers/broader |
| **dead-code** | knip | Unused exports, files, dependencies | JS/TS (requires tsconfig/entry point detection). No real alternative exists for other languages |
| **dependencies** | `npm outdated --json` | Staleness, major versions behind | JS/TS (future: pip, cargo, go mod) |
| **circular-deps** | dependency-cruiser (primary) | Circular dependency chains + architectural boundary enforcement | JS/TS. dependency-cruiser's rules system can enforce "UI layer must not import data layer." Alternative: skott (7x faster than madge, cleaner API) or jscycles (Rust, 50-100x faster for circular-only checks on huge repos) |
| **test-coverage** | vitest/jest coverage | Coverage percentages (if test runner detected) | JS/TS |
| **git-health** | gitlog + code-complexity npm packages + git blame | Bus factor, churn hotspots, TODO/FIXME age, stale areas, DORA-adjacent | Any repo with git history |

#### git-health module detail

Git history is the richest signal source for codebase health and is language-agnostic:

- **Bus factor** per file/directory — author concentration from `git log --format='%aN'`. Files where >80% of commits come from one author are knowledge silos.
- **Churn hotspots** — files with most commits × highest complexity = highest risk. The `code-complexity` npm package computes this directly. Classify files into **quadrants** (inspired by Nikui): Toxic (high churn + high complexity), Frozen (low churn + high complexity), Quick Win (high churn + low complexity), Healthy (low churn + low complexity).
- **TODO/FIXME age** — `git blame` on each TODO to determine when it was introduced. TODOs older than 90 days are broken windows.
- **Stale areas** — directories with no commits in N months. May indicate dead code or abandoned features.
- **DORA-adjacent metrics** — deploy frequency (tag/release cadence), lead time (PR open → merge from `git log --merges`), change failure rate (revert commits per merge). These power the trends page.

### AI Modules (Claude API, with confidence scores + token budgets)

| Module | Model | What it measures |
|--------|-------|-----------------|
| **naming-quality** | Sonnet | Cryptic variable/function names, clarity scores |
| **doc-staleness** | Sonnet | Does README match actual project structure? |
| **arch-smells** | Opus | God files, misplaced logic, layer violations |
| **test-quality** | Sonnet | Meaningful assertions? Edge cases? Implementation coupling? |

**AI sampling strategy:** Don't sample randomly. Weight file selection by: (1) complexity score from the static complexity module, (2) churn frequency from git-health, (3) import/dependency count. The files most worth AI analysis are complex, change often, and are heavily depended on. Select top 20-30 files by this composite score. Token budget is configurable per scan with a default cap of 100K tokens.

**Token efficiency:** Send AST summaries (function signatures, class structures, dependency lists) extracted via tree-sitter rather than raw source code. Research shows this reduces tokens by ~67% with minimal quality loss. Use `codified prompting` (structured/code-formatted prompts) rather than prose — shown to improve accuracy by 10.7% while reducing tokens by 67.8%.

### Prompt Generator (the differentiator)

After a scan completes, vibecheck can generate **ready-to-paste Claude Code prompts** from the prioritized findings. This is not a module — it's a post-scan action that consumes module results.

```
Scan results → Priority ranking (severity × confidence × churn) → Prompt template

Example output:
"The OrderProcessor class (src/orders/processor.ts:1-340) has cyclomatic
complexity 34, a bus factor of 1 (only alice has committed), and 12% test
coverage. Refactor it into three modules: validation, transformation, and
persistence. Add tests for the validation module first — it has 4 untested
edge cases around null shipping addresses."
```

The prompt generator:
- Groups related findings across modules (e.g., a file that's complex AND has naming issues AND low coverage)
- Prioritizes by impact: severity × confidence × churn rate
- Produces file-specific instructions with line numbers
- Includes context from git-health (who owns it, how often it changes, what depends on it)
- Available as a "Copy prompt" button on the repo detail page and as a CLI output option

### Future Modules

- **accessibility** — carry over axe-core scanning from fixready (if repo has web frontend)
- **type-safety** — `any` usage, TypeScript strictness, type coverage
- **performance** — bundle size, dynamic imports, tree-shaking
- **polyglot extensions** — pip-audit for Python, cargo-audit for Rust, govulncheck for Go (each as a variant of the security module)
- **ast-grep rules** — custom YAML-based structural pattern matching for architectural smells (god classes, deeply nested callbacks, etc.) without needing AI. Could partially replace or supplement the arch-smells AI module
- **MCP server** — expose vibecheck's scan results and prompt generator as MCP tools so Claude Code (and any MCP-capable agent) can query health metrics natively

---

## Data Model (SQLite + Drizzle)

```
repos           → id, path, name, overall_score, last_scan_at
scans           → id, repo_id, status, overall_score, config_snapshot, token_usage, duration_ms
module_results  → id, scan_id, module_id, score, confidence, summary, metrics (JSON)
findings        → id, module_result_id, fingerprint, severity, file_path, line, message, category, status
scan_configs    → id, repo_id, enabled_modules (JSON), ai_token_budget
prompts         → id, scan_id, generated_prompt (TEXT), finding_ids (JSON), created_at
```

**Fingerprinting** (carried from fixready): Each finding gets a SHA-256 fingerprint. On subsequent scans, compare fingerprints to mark findings as `new | recurring | fixed | regressed`.

---

## Dashboard Layout

### `/dashboard` — Multi-repo overview
Card grid showing each registered repo with: name, overall score, sparkline trend, module breakdown bar, last scanned, quick "Scan" button.

### `/repo/[id]` — Single repo health (main view)
- Summary row: overall score gauge, total findings, modules passing, scan duration
- **"Generate Claude Prompt" button** — produces prioritized instructions from top findings, copy to clipboard
- **Radar chart** (Nivo): spider chart of all module scores at once (instant visual "shape")
- **Hotspot quadrant** (Nivo scatterplot): files plotted on churn × complexity axes, colored by quadrant (Toxic/Frozen/Quick Win/Healthy)
- Module grid: card per module with score ring, confidence badge, top 3 findings
- Recent findings table (sortable, filterable)

### `/repo/[id]/[moduleId]` — Module drilldown
- Score trend line chart
- Full findings table with severity, file, line, message, status
- Module-specific visualizations:
  - **complexity**: treemap (Nivo) — file size = LOC, color = complexity score
  - **circular-deps**: force-directed dependency graph (react-force-graph)
  - **git-health**: bus factor heatmap (Nivo) + churn timeline

### `/repo/[id]/trends` — Historical view
- Multi-line chart: one line per module score over time
- Stacked area chart: new/recurring/fixed/regressed findings per scan
- DORA-adjacent metrics from git-health: deploy frequency, lead time, change failure rate

### `/settings` — Configuration
- Anthropic API key input
- Module enable/disable toggles
- AI token budget slider
- Repo management (add/remove)
- Overall score weighting (equal weight default, slider per module)

---

## Project Structure

```
vibecheck/
  app/
    layout.tsx
    page.tsx                          → redirect to /dashboard
    dashboard/page.tsx                → multi-repo grid
    repo/[id]/page.tsx                → repo health overview
    repo/[id]/[moduleId]/page.tsx     → module drilldown
    repo/[id]/trends/page.tsx         → historical charts
    settings/page.tsx                 → config
    api/
      repos/route.ts                  → CRUD repos
      scans/route.ts                  → trigger scan
      scans/[id]/route.ts             → scan results
      scans/[id]/progress/route.ts    → SSE progress stream
      scans/[id]/prompt/route.ts      → generate Claude prompt from findings
      settings/route.ts               → get/put config
  components/
    ui/                               → shadcn components (from fixready)
    repo-health-card.tsx
    module-score-card.tsx
    radar-chart.tsx                   → Nivo radar
    hotspot-quadrant.tsx              → Nivo scatterplot (churn × complexity)
    score-gauge.tsx
    trend-sparkline.tsx
    findings-table.tsx
    scan-progress.tsx
    prompt-output.tsx                 → generated prompt display + copy button
    treemap-viz.tsx                   → Nivo treemap for complexity
    dep-graph-viz.tsx                 → react-force-graph for dependencies
  lib/
    db/
      client.ts                       → better-sqlite3 + Drizzle
      schema.ts                       → Drizzle schema
      migrations/
    modules/
      types.ts                        → ModuleDefinition, ModuleRunner, ModuleResult, Finding
      registry.ts                     → module registration
      orchestrator.ts                 → run all modules, aggregate, SSE progress
      fingerprint.ts                  → from fixready, generalized
      scoring.ts                      → aggregate score computation (equal weights, configurable)
      complexity/                     → rust-code-analysis (REST) + ts-morph fallback
      security/                       → npm audit wrapper
      dead-code/                      → knip wrapper
      dependencies/                   → npm outdated wrapper
      circular-deps/                  → dependency-cruiser wrapper
      test-coverage/                  → coverage parser
      git-health/                     → gitlog + code-complexity + git blame
      naming-quality/                 → AI module
      doc-staleness/                  → AI module
      arch-smells/                    → AI module
      test-quality/                   → AI module
    ai/
      client.ts                       → Anthropic SDK singleton
      model-routing.ts                → module → model mapping
      token-tracker.ts                → budget management
      sampling.ts                     → weighted file selection (complexity × churn × imports)
      prompts/                        → prompt templates per AI module (codified format, not prose)
    prompt-generator/
      generator.ts                    → scan results → prioritized Claude prompt
      templates.ts                    → prompt templates per finding type
      prioritizer.ts                  → severity × confidence × churn ranking
```

---

## What to Carry Over from FixReady

### Reuse directly (copy + adapt)
- `lib/scanner/fingerprint.ts` → generalize for all module types
- `lib/scanner/orchestrator.ts` → replace Supabase with Drizzle, iterate modules instead of pages
- `lib/fixes/fix-generator.ts` → AI client singleton, model routing, error handling patterns
- `components/ui/*` → all shadcn components
- `components/theme-provider.tsx`, `theme-toggle.tsx`, `app-sidebar.tsx`
- Dashboard card grid layout pattern from `app/(dashboard)/dashboard/page.tsx`

### Reuse patterns (not literal code)
- Scoring curves, severity color mapping, status badges
- Discriminated union result types (`{ success, data } | { success, error }`)
- Mock data → real data wiring approach

### Drop entirely
- Clerk auth, Stripe billing, Supabase client/RLS, BullMQ/Redis, Playwright/axe-core, DOM extractor, middleware

---

## Build Phases

### Phase 1: Foundation + 4 Static Modules
1. Next.js 15 scaffold + shadcn + Tailwind + Nivo
2. SQLite + Drizzle schema + migrations
3. Module system (types, registry, orchestrator, fingerprint)
4. **complexity**, **security**, **dependencies**, **git-health** modules
5. Dashboard overview + repo detail pages (including hotspot quadrant)
6. API routes + SSE scan progress
7. Settings page

### Phase 2: Remaining Static + Trends + Prompt Generator
8. **dead-code**, **circular-deps**, **test-coverage** modules
9. Trends page with historical charts (including DORA-adjacent from git-health)
10. Fingerprint-based finding status tracking (new/recurring/fixed/regressed)
11. **Prompt generator** — "Generate Claude Prompt" button on repo detail page

### Phase 3: AI Modules
12. AI client layer + token tracker + weighted sampling + tree-sitter AST summarization
13. **naming-quality**, **doc-staleness**, **arch-smells**, **test-quality** modules
14. Radar chart on repo detail page
15. Confidence score indicators throughout UI
16. AI findings feed into prompt generator for richer instructions

### Phase 4: Polish + Power User
17. CLI launcher: `npx vibecheck /path/to/repo`
18. CLI prompt output: `npx vibecheck /path/to/repo --prompt` (scan + generate prompt to stdout)
19. Report export (markdown/PDF)
20. Scan comparison (side-by-side two scans)
21. Module-specific visualizations (treemaps, dep graphs, bus factor heatmaps)
22. Per-repo `.vibecheckrc` config for custom thresholds
23. Monorepo support: detect `workspaces` in package.json, treat each as a separate repo entry

### Phase 5: MCP + Ecosystem
24. MCP server exposing vibecheck tools (`vibecheck_scan`, `vibecheck_health`, `vibecheck_prompt`) so Claude Code can query health natively
25. ast-grep YAML rules module for structural smell detection without AI
26. Static HTML report export (single self-contained file, shareable)

---

## Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| better-sqlite3 vs bun:sqlite | **better-sqlite3** | Battle-tested, Bun isn't the target runtime |
| Complexity engine | **rust-code-analysis** (primary) + lizard (fallback) | rust-code-analysis: tree-sitter-based, 20+ languages, REST API mode, measures cognitive complexity + Halstead + maintainability index. Richer than lizard. Fallback to lizard if Rust binary isn't available |
| ts-morph performance on large repos | **Cap at 500 files**, sort by size desc, warn if truncated | Pragmatic limit; rust-code-analysis handles the language-agnostic pass without perf issues |
| Dependency analysis | **dependency-cruiser** (replaces madge) | Rules system for architectural boundary enforcement, mermaid/JSON/SVG output. Skott as faster alternative if needed |
| Git analysis | **gitlog** + **code-complexity** npm packages | code-complexity already computes churn × complexity hotspots. gitlog provides structured commit data |
| knip false positives | Auto-detect `tsconfig.json` and entry points from `package.json` main/exports | Offer `.vibecheckrc` override for edge cases |
| AI sampling strategy | **Weighted selection**: complexity score × churn frequency × import count → top 20-30 files | High-value files get AI analysis; random sampling wastes tokens on boring files |
| AI token efficiency | **AST summaries via tree-sitter** + codified prompting format | Research shows ~67% token reduction with minimal quality loss |
| Visualization | **Nivo** (primary) + Recharts (simple trends) + react-force-graph (dep graphs) | Nivo has treemaps, radar, heatmaps, scatterplots with beautiful defaults. react-force-graph for interactive dependency exploration |
| Hotspot model | **Quadrant classification** (Nikui-inspired): Toxic, Frozen, Quick Win, Healthy | Churn × complexity axes. Immediately actionable — "fix Toxic files first, Quick Wins are low-hanging fruit" |
| Scoring calibration | **Equal weights** by default, expose per-module weight slider in settings | Ship simple, let users adjust. Revisit adaptive weighting only if users ask for it |
| Monorepo support | **Phase 4** | Detect `workspaces` in package.json, treat each workspace as a separate repo in the dashboard |
| Next.js version | **15 (stable)** | 16/Turbopack is bleeding edge; nothing in this architecture requires it. Upgrade later when stable |

---

## Tools & Libraries Reference

Discovered during research, cataloged here for implementation reference.

### Static analysis

| Tool | Use case | Notes |
|------|----------|-------|
| **rust-code-analysis** (Mozilla) | Multi-language complexity metrics | Tree-sitter-based, REST API mode, 20+ languages. github.com/mozilla/rust-code-analysis |
| **lizard** | Fallback complexity analyzer | Python, 30+ languages, `--json` output. github.com/terryyin/lizard |
| **complexipy** | Python cognitive complexity | Rust-based, blazing fast. github.com/rohaquinlop/complexipy |
| **ast-grep** | Structural code search/lint | Tree-sitter YAML rules, WASM bindings available. ast-grep.github.io |
| **knip** | Dead code detection (JS/TS) | Best in class, no real alternative. knip.dev |
| **dependency-cruiser** | Dependency validation + visualization | Rules system, mermaid/JSON/SVG output. github.com/sverweij/dependency-cruiser |
| **skott** | Fast dependency analysis | 7x faster than madge, built-in webapp viz. github.com/antoine-coulon/skott |
| **jscycles** | Circular dependency detection | Rust, 50-100x faster than madge. github.com/EnderHub/jscycles |
| **gitlog** | Structured git log parsing | npm package. npmjs.com/package/gitlog |
| **code-complexity** | Churn × complexity hotspots | npm package. npmjs.com/package/code-complexity |
| **FTA** | Fast TypeScript analysis | Rust-based, ~1600 files/sec. ftaproject.dev |

### Visualization

| Tool | Use case | Notes |
|------|----------|-------|
| **Nivo** | Treemaps, radar, heatmaps, scatterplots | Beautiful defaults, 13.5K stars. nivo.rocks |
| **Visx** (Airbnb) | Custom D3+React visualizations | Low-level primitives, 19.9K stars. For anything Nivo can't do |
| **react-force-graph** | Interactive dependency graphs | 2D/3D/VR force-directed graphs. github.com/vasturiano/react-force-graph |

### AI code analysis (reference implementations)

| Tool | What to learn from it |
|------|----------------------|
| **Nikui** | Quadrant model (Toxic/Frozen/Quick Win/Healthy), LLM + static + git churn combination. github.com/Blue-Bear-Security/nikui |
| **PR-Agent** (Qodo) | Prompt templates for code review patterns, self-hostable. github.com/qodo-ai/pr-agent |
| **codebase-digest** | 60+ pre-built analysis prompts for LLMs. github.com/kamilstanuch/codebase-digest |

### MCP servers (ecosystem integration)

| Server | Relevance |
|--------|-----------|
| **mcp-server-tree-sitter** | Language-agnostic AST analysis via MCP |
| **SonarQube MCP Server** | Code quality via MCP (official). github.com/SonarSource/sonarqube-mcp-server |
| **code-analysis-mcp** | Dedicated code analysis MCP. github.com/saiprashanths/code-analysis-mcp |

### Token efficiency research

- **Codified prompting**: +10.7% accuracy, -67.8% tokens vs prose prompts
- **TALE-EP**: -67% output tokens, -59% cost, competitive quality
- **Key technique**: Send tree-sitter AST summaries (signatures, structures) not raw source. Dramatically fewer tokens, preserves architectural information

---

## Open Questions (remaining)

- **Language detection UX**: When a non-JS/TS repo is scanned, how should the dashboard communicate which modules ran vs. were skipped? Greyed-out cards? A "not applicable" badge?
- **Prompt generator templates**: What's the right prompt structure for different finding types? Needs iteration once real scan data is flowing. Reference codebase-digest's 60+ prompt library for inspiration.
- **Scheduled scans**: Should vibecheck support cron-style automatic re-scans? Or is manual "click scan" sufficient for v1?
- **rust-code-analysis distribution**: Ship as a pre-built binary? Expect user to install? Docker sidecar? Or fall back to lizard (Python) if the Rust binary isn't available?
- **Name collision**: "vibecheck" and "vibe-check" both exist as tools in this space (copyleftdev's Zig CLI, vibe-check.cloud). May need to differentiate in naming/branding.
