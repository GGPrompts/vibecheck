#!/usr/bin/env node
/**
 * Vibecheck MCP Server
 *
 * Exposes vibecheck codebase health scanning capabilities as MCP tools,
 * communicating over stdio transport for use with Claude Code and other
 * MCP-capable agents.
 *
 * Tools:
 *   - vibecheck_scan     — trigger a full scan on a repository
 *   - vibecheck_health   — get latest health scores (overall + per-module)
 *   - vibecheck_module   — get a single module result with metrics/applicability
 *   - vibecheck_compare  — compare two scans for regressions and deltas
 *   - vibecheck_prompt   — generate a Claude-optimized prompt from findings
 *   - vibecheck_next_actions — get concise next-action bundles for agents
 *   - vibecheck_findings — list findings with filters (severity, module, status)
 *   - vibecheck_settings — get or set vibecheck configuration
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  vibecheckScanInput,
  vibecheckHealthInput,
  vibecheckModuleInput,
  vibecheckCompareInput,
  vibecheckPromptInput,
  vibecheckNextActionsInput,
  vibecheckFindingsInput,
  vibecheckSettingsInput,
  handleVibecheckScan,
  handleVibecheckHealth,
  handleVibecheckModule,
  handleVibecheckCompare,
  handleVibecheckPrompt,
  handleVibecheckNextActions,
  handleVibecheckFindings,
  handleVibecheckSettings,
} from './tools.js';

const server = new McpServer(
  {
    name: 'vibecheck',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Register tools ──────────────────────────────────────────────────────

server.tool(
  'vibecheck_scan',
  'Trigger a vibecheck scan on a repository. Runs all enabled analysis modules (security, complexity, dependencies, dead code, etc.) and returns a scan ID with the overall health score.',
  vibecheckScanInput,
  handleVibecheckScan
);

server.tool(
  'vibecheck_health',
  'Get the latest health scores for a repository, including overall score, per-module state, confidence, metrics, and summaries.',
  vibecheckHealthInput,
  handleVibecheckHealth
);

server.tool(
  'vibecheck_module',
  'Inspect one module result for the latest scan or a specific scan. Returns score, confidence, state, metrics, applicability, summary, and findings.',
  vibecheckModuleInput,
  handleVibecheckModule
);

server.tool(
  'vibecheck_compare',
  'Compare two scans for score deltas, regressions, and new findings.',
  vibecheckCompareInput,
  handleVibecheckCompare
);

server.tool(
  'vibecheck_prompt',
  'Generate a Claude-optimized prompt from the latest scan findings. The response includes the prompt plus structured next-action bundles.',
  vibecheckPromptInput,
  handleVibecheckPrompt
);

server.tool(
  'vibecheck_next_actions',
  'Return the top next-action bundles from the latest scan, grouped by file and ready for agent execution.',
  vibecheckNextActionsInput,
  handleVibecheckNextActions
);

server.tool(
  'vibecheck_findings',
  'List findings from a scan with optional filters. Findings are sorted by severity. Use filters to focus on specific modules, severity levels, or statuses (new, recurring, fixed, regressed).',
  vibecheckFindingsInput,
  handleVibecheckFindings
);

server.tool(
  'vibecheck_settings',
  'Get or set vibecheck configuration. Use action "get" to read current settings (profile, tier, enabled modules, AI provider, model overrides). Use action "set" with any combination of fields to update settings — e.g. switch a solo project from team to solo profile, or bump the scan tier for deeper analysis.',
  vibecheckSettingsInput,
  handleVibecheckSettings
);

// ── Start server ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Vibecheck MCP server failed to start:', error);
  process.exit(1);
});
