# Visualizer Data Layer

Backend data pipelines for the architecture map at `/repo/[id]/map`.

## Files

### graph-builder.ts
Builds a graphology dependency graph from repo source files.

- `buildImportGraph(repoPath): SerializedGraph`
- Primary: uses dependency-cruiser (`depcruise --output-type json`)
- Fallback: regex-based import parsing when depcruise unavailable
- Node attributes: `filePath`, `loc`, `fanIn`, `fanOut`, `isDynamic`, `isIsland`, `isEntryPoint`, `circularDeps`
- Edge attributes: `isDynamic`, `symbols`
- API: `GET /api/repos/[id]/graph` (cached 5min)

### file-health.ts
Aggregates scan findings into per-file health scores.

- `aggregateFileHealth(repoId, scanId?): FileHealthMap`
- Severity weights: critical -30, high -20, medium -10, low -5, info 0
- Color buckets: 0-40 red, 40-70 yellow, 70-100 green
- API: `GET /api/repos/[id]/file-health?scanId=X`

### architecture.ts
Analyzes import graph for architectural patterns.

- `analyzeArchitecture(graph, fileRoles?): ArchitectureAnalysis`
- Louvain community detection for feature area clustering (via graphology-communities-louvain)
- Layer classification: UI, API, Business, Data, Utils, Infra
- Layer violation detection (e.g., UI importing Data directly)
- Cross-community coupling metrics
- Blast radius: BFS on reverse edges, counts transitive dependents
- Cohesion: internal vs total edges per community
- API: `GET /api/repos/[id]/architecture` (cached 5min)

## Frontend

Components in `components/visualizer/`:

| Component | Purpose |
|-----------|---------|
| graph-renderer.tsx | Sigma.js + graphology rendering, ForceAtlas2 layout |
| graph-controls.tsx | Zoom, fit view, stats, legend |
| file-sidebar.tsx | Click-to-inspect file details panel |
| blast-radius-mode.tsx | Highlight transitive dependents on click |
| filter-panel.tsx | Filter by health color, layer, text search |
| time-slider.tsx | Scrub through scan history, animate health changes |

## Tech

- **graphology** — Graph data structure (shared backend + frontend)
- **graphology-communities-louvain** — Community detection
- **graphology-layout-forceatlas2** — Force-directed layout
- **sigma 3** — WebGL graph rendering
- **@react-sigma/core** — React bindings for Sigma
