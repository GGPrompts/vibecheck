#!/usr/bin/env node
/**
 * Vibecheck MCP Server
 *
 * Exposes vibecheck codebase health scanning capabilities as MCP tools,
 * communicating over stdio transport for use with Claude Code and other
 * MCP-capable agents.
 *
 * Tools:
 *   - vibecheck_scan    — trigger a full scan on a repository
 *   - vibecheck_health  — get latest health scores (overall + per-module)
 *   - vibecheck_prompt  — generate a Claude-optimized prompt from findings
 *   - vibecheck_findings — list findings with filters (severity, module, status)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  vibecheckScanInput,
  vibecheckHealthInput,
  vibecheckPromptInput,
  vibecheckFindingsInput,
  handleVibecheckScan,
  handleVibecheckHealth,
  handleVibecheckPrompt,
  handleVibecheckFindings,
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
  'Get the latest health scores for a repository, including the overall score and per-module breakdowns (score, confidence, summary).',
  vibecheckHealthInput,
  handleVibecheckHealth
);

server.tool(
  'vibecheck_prompt',
  'Generate a Claude-optimized prompt from the latest scan findings. The prompt prioritizes issues by severity, confidence, and change frequency, grouped by file.',
  vibecheckPromptInput,
  handleVibecheckPrompt
);

server.tool(
  'vibecheck_findings',
  'List findings from a scan with optional filters. Findings are sorted by severity. Use filters to focus on specific modules, severity levels, or statuses (new, recurring, fixed, regressed).',
  vibecheckFindingsInput,
  handleVibecheckFindings
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
