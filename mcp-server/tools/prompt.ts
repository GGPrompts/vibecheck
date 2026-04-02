/**
 * vibecheck_prompt — generate a Claude-optimized prompt from scan findings.
 */
import { z } from 'zod';
import { generatePrompt } from '@/lib/prompt-generator/generator';
import { requireRepoAndScan, textResponse, jsonResponse } from './helpers.js';
import type { ToolResponse } from './helpers.js';

export const vibecheckPromptInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  scan_id: z
    .string()
    .optional()
    .describe('Specific scan ID to generate prompt from (defaults to latest completed scan)'),
};

export const vibecheckNextActionsInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  scan_id: z
    .string()
    .optional()
    .describe('Specific scan ID to summarize (defaults to latest completed scan)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Max number of action bundles to return (default 5)'),
};

export async function handleVibecheckPrompt(args: {
  repo_path: string;
  scan_id?: string;
}): Promise<ToolResponse> {
  const { repo_path, scan_id } = args;

  let targetScanId = scan_id;

  if (!targetScanId) {
    const result = requireRepoAndScan(repo_path);
    if ('error' in result) return result.error;
    targetScanId = result.scan.id;
  }

  try {
    const result = await generatePrompt(targetScanId);
    return jsonResponse({
      scan_id: targetScanId,
      estimated_tokens: result.estimated_tokens,
      prompt: result.prompt,
      actions: result.actions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResponse(`Prompt generation failed: ${message}`);
  }
}

export async function handleVibecheckNextActions(args: {
  repo_path: string;
  scan_id?: string;
  limit?: number;
}): Promise<ToolResponse> {
  const { repo_path, scan_id, limit = 5 } = args;

  let targetScanId = scan_id;

  if (!targetScanId) {
    const result = requireRepoAndScan(repo_path);
    if ('error' in result) return result.error;
    targetScanId = result.scan.id;
  }

  try {
    const result = await generatePrompt(targetScanId);
    return jsonResponse({
      scan_id: targetScanId,
      total_actions: result.actions.length,
      returned: result.actions.slice(0, limit).length,
      next_actions: result.actions.slice(0, limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResponse(`Next actions summary failed: ${message}`);
  }
}
