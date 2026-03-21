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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResponse(`Prompt generation failed: ${message}`);
  }
}
