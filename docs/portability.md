# Portability: Embedding VibeCheck in Other Apps

VibeCheck is designed to potentially be embedded as a section/panel in a larger Next.js dashboard (e.g., personal-homepage). This doc captures architectural decisions that support that goal.

## Target Integration

The personal-homepage project (Next.js 15, Tailwind, shadcn/ui) has an accordion sidebar with ~30 sections (weather, stocks, AI workspace, etc.). VibeCheck would become a "Code Health" section showing repo scores, findings, and trends — with the full graph/deep-dive available as a drill-down.

## Architecture Principles

### 1. Thin API routes, fat lib functions

API routes should be thin wrappers around pure library functions. All scan logic, DB queries, and module orchestration should live in `lib/` with no dependency on Next.js request/response types.

```
Good:  lib/scans/run-scan.ts exports runScan(repoId, options) → ScanResult
       app/api/scans/route.ts calls runScan() and wraps in NextResponse

Bad:   app/api/scans/route.ts contains scan orchestration logic directly
```

This means another app can `import { runScan } from 'vibecheck/lib/scans'` without needing the API layer.

### 2. Summary view as first-class citizen

The full Sigma.js graph is impressive but heavyweight (WebGL, graphology, force-atlas layout). Design a **summary view** that works without it:

- Health score cards per repo (just numbers + colors)
- Top N findings list (severity-sorted table)
- Trend sparklines (lightweight — Recharts or even inline SVG)
- Module score breakdown (radar or simple bar chart)

The summary view is what gets embedded. The full graph stays as an optional drill-down that can lazy-load Sigma.js only when needed.

### 3. Shared types package

Keep all TypeScript types for scan results, findings, module results, and repo metadata in a single `lib/types/` directory. These types become the contract between VibeCheck's core and any consuming UI.

Key types to keep stable and well-documented:
- `ScanResult` — overall scan output with scores
- `Finding` — individual issue with severity, module, file, line
- `ModuleResult` — per-module score + confidence + findings
- `RepoHealth` — aggregated health score with breakdown

### 4. Components receive data as props

UI components should receive data through props, not fetch internally or depend on URL params:

```
Good:  <FindingsTable findings={findings} onFilter={...} />
Bad:   <FindingsTable repoId={params.id} />  // fetches internally
```

This makes components embeddable in any context — a homepage section, the full app, or even a different tool.

### 5. SQLite as single source of truth

The SQLite DB at `~/.vibecheck/vibecheck.db` is the canonical data store. Avoid spreading state to:
- localStorage (not accessible from other apps)
- In-memory caches that can't be shared
- Config files that duplicate DB data

Another app embedding VibeCheck just needs read access to the same SQLite file.

### 6. Lazy-load heavy dependencies

These deps are large and should be dynamically imported, not bundled in the main chunk:
- `sigma` + `graphology` + layout algorithms (WebGL graph)
- `@nivo/*` (treemaps, radar, heatmaps)
- `ts-morph` (AST analysis — server-only)
- `knip`, `dependency-cruiser` (CLI tools — server-only)

Use `next/dynamic` or dynamic `import()` so an embedding app only pays for what it uses.

### 7. MCP server as integration bridge

The MCP server (`mcp-server/`) already exposes a clean interface:
- `vibecheck_scan` — trigger scans
- `vibecheck_health` — get repo health
- `vibecheck_findings` — query findings
- `vibecheck_prompt` — generate fix prompts

This can serve as the integration layer before a full UI port. The homepage could call MCP tools and render results in its own components.

## Integration Approaches (Least → Most Effort)

### A. MCP-only (no UI port)
Homepage section calls VibeCheck MCP tools, renders results in homepage components. Zero shared code beyond types.

### B. API sidecar
Run VibeCheck's Next.js server on a separate port. Homepage section fetches from it. Share Tailwind theme tokens for visual consistency.

### C. Shared lib import
Import `vibecheck/lib/*` directly into homepage. Share the SQLite connection. Build summary components in homepage using VibeCheck's types and data functions. Full graph available via lazy-loaded embed.

### D. Full section port
Move VibeCheck's UI components into homepage. Most ambitious — requires resolving dependency conflicts (Next.js 15 vs 16, React versions) and careful bundle splitting.

## Checklist for Port-Readiness

- [ ] All scan/query logic callable from `lib/` without API routes
- [ ] Summary components exist that don't require Sigma.js
- [ ] Types are centralized in `lib/types/`
- [ ] Components accept data as props (no internal fetching)
- [ ] Heavy deps are lazy-loaded
- [ ] MCP server covers all read operations needed for a dashboard view
- [ ] No localStorage usage for persistent state (SQLite only)
