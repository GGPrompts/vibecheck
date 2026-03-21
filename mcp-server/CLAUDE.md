# MCP Server

Exposes vibecheck as an MCP tool server for Claude Code integration. Communicates over stdio.

## Tools (5)

| Tool | Input | Output |
|------|-------|--------|
| `vibecheck_scan` | `repo_path` | Triggers full scan, returns scan_id + overall score |
| `vibecheck_health` | `repo_path` | Latest health scores: overall + per-module breakdown |
| `vibecheck_prompt` | `repo_path`, `scan_id?` | Generated Claude-optimized prompt from findings |
| `vibecheck_findings` | `repo_path`, `scan_id?`, `severity?`, `module?`, `status?`, `limit?` | Filtered findings list |
| `vibecheck_settings` | `action` (`get`/`set`), `profile?`, `tier?`, `enabledModules?`, `aiTokenBudget?`, `aiProvider?`, `modelOverrides?` | Current settings (get) or confirmation of updates (set) |

## Architecture

- `index.ts` — Server entrypoint, registers tools, sets up stdio transport
- `tools.ts` — Tool implementations, reuses `lib/` code (orchestrator, prompt-generator, db queries)

## Auto-registration

All tools auto-register repos in the DB if not found. Uses existing `lib/db/` queries and `lib/modules/orchestrator.ts` for scanning.

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
