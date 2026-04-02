# MCP Server

Exposes vibecheck as an MCP tool server for Claude Code integration. Communicates over stdio.

## Tools (8)

| Tool | Input | Output |
|------|-------|--------|
| `vibecheck_scan` | `repo_path` | Triggers full scan, returns scan_id + overall score |
| `vibecheck_health` | `repo_path` | Latest health scores with module state, confidence, metrics, and summary data |
| `vibecheck_module` | `repo_path`, `module_id`, `scan_id?` | Single module result with findings, metrics, confidence, applicability, and state |
| `vibecheck_compare` | `repo_path`, `base_scan_id?`, `head_scan_id?`, `limit?` | Regression-oriented scan comparison with score deltas and new findings |
| `vibecheck_prompt` | `repo_path`, `scan_id?` | Generated Claude-optimized prompt plus structured next-action bundles |
| `vibecheck_next_actions` | `repo_path`, `scan_id?`, `limit?` | Compact next-action bundles grouped by file |
| `vibecheck_findings` | `repo_path`, `scan_id?`, `severity?`, `module?`, `status?`, `limit?` | Filtered findings with module confidence, state, metrics, and suggestions |
| `vibecheck_settings` | `action` (`get`/`set`), `profile?`, `tier?`, `enabledModules?`, `aiTokenBudget?`, `aiProvider?`, `modelOverrides?` | Current settings (get) or confirmation of updates (set) |

## Architecture

- `index.ts` — Server entrypoint, registers tools, sets up stdio transport
- `tools.ts` — Barrel re-export for tool entrypoints
- `tools/*.ts` — Per-tool implementations and payload builders, reusing shared `lib/` code where possible

## Auto-registration

`vibecheck_scan` auto-registers repos in the DB if not found. Read-only tools expect the repo to already exist and return a structured not-found response when it does not.

## Request / Response Notes

- Module detail and health responses include `state`, `state_reason`, `confidence`, `metrics`, `applicable`, and `summary` when available.
- `vibecheck_compare` defaults to the latest two completed scans when explicit scan IDs are omitted.
- `vibecheck_next_actions` and `vibecheck_prompt` reuse the same prioritization pipeline; `next_actions` is the compact agent-facing shape.

## Usage

Add to Claude Code MCP config:
```json
{
  "mcpServers": {
    "vibecheck": {
      "command": "npx",
      "args": ["tsx", "/path/to/vibecheck/mcp-server/index.ts"]
    }
  }
}
```
