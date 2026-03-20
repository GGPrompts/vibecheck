import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { getProvider } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import { selectFilesForAnalysis } from '@/lib/ai/sampling';
import { ERROR_HANDLING_SYSTEM, buildErrorHandlingPrompt } from '@/lib/ai/prompts/error-handling';
import type { ErrorHandlingInput } from '@/lib/ai/prompts/error-handling';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'error-handling';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 8,
  high: 6,
  medium: 4,
  low: 2,
  info: 0,
};

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
};

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    const provider = await getProvider();
    return provider.isAvailable();
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    const provider = await getProvider();
    if (!(await provider.isAvailable())) {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'AI not available',
      };
    }

    const tracker = createTokenTracker(25_000);

    opts.onProgress?.(5, 'Selecting files for error handling analysis...');

    const sampledFiles = await selectFilesForAnalysis(repoPath, [], 20);

    if (sampledFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { filesAnalyzed: 0 },
        summary: 'No source files found for error handling analysis.',
      };
    }

    opts.onProgress?.(15, `Analyzing error handling in ${sampledFiles.length} files...`);

    const allFindings: Finding[] = [];

    // Batch files in groups of 5 for efficiency
    const batchSize = 5;
    for (let i = 0; i < sampledFiles.length; i += batchSize) {
      if (opts.signal?.aborted) break;
      if (tracker.isExhausted()) break;

      const batch = sampledFiles.slice(i, i + batchSize);
      const inputs: ErrorHandlingInput[] = [];

      for (const sampled of batch) {
        const fullPath = join(repoPath, sampled.filePath);
        let content: string;
        try {
          content = readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }
        const ext = extname(sampled.filePath);
        inputs.push({
          filePath: sampled.filePath,
          content,
          language: LANGUAGE_MAP[ext] ?? 'typescript',
        });
      }

      if (inputs.length === 0) continue;

      const userPrompt = buildErrorHandlingPrompt(inputs);

      try {
        const response = await provider.query(userPrompt, {
          model: getModelForModule(MODULE_ID),
          maxTokens: 4096,
          system: ERROR_HANDLING_SYSTEM,
        });

        if (provider.tracksCost && response.inputTokens != null && response.outputTokens != null) {
          tracker.track(response.inputTokens, response.outputTokens);
        }

        const text = response.text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch
          ? JSON.parse(jsonMatch[0])
          : { findings: [] };

        if (Array.isArray(parsed.findings)) {
          for (const f of parsed.findings) {
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: f.severity ?? 'medium',
              filePath: f.filePath ?? '',
              line: f.line ?? undefined,
              message: f.message ?? 'Error handling issue',
              category: 'error-handling',
              suggestion: f.suggestion ?? undefined,
            };
            allFindings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }
      } catch (err) {
        // API error for this batch -- continue with remaining batches
        if (
          err instanceof Error &&
          err.message.includes('abort')
        ) {
          break;
        }
        // Otherwise swallow and continue
      }

      const progress = 15 + Math.round(((i + batchSize) / sampledFiles.length) * 75);
      opts.onProgress?.(Math.min(progress, 90), `Processed ${Math.min(i + batchSize, sampledFiles.length)} of ${sampledFiles.length} files...`);
    }

    opts.onProgress?.(95, 'Computing error handling score...');

    // Scoring: start at 100, deduct per finding
    let score = 100;
    for (const f of allFindings) {
      score -= SEVERITY_DEDUCTIONS[f.severity] ?? 2;
    }
    score = Math.max(0, score);

    const usage = tracker.getUsage();

    const metrics: Record<string, number> = {
      filesAnalyzed: sampledFiles.length,
      findingsCount: allFindings.length,
      tokensUsed: usage.totalTokens,
    };

    const summary = allFindings.length > 0
      ? `Found ${allFindings.length} error handling issues across ${sampledFiles.length} files. Score: ${score}/100.`
      : `No error handling issues found in ${sampledFiles.length} files analyzed.`;

    opts.onProgress?.(100, 'Error handling analysis complete.');

    return {
      score,
      confidence: 0.75,
      findings: allFindings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Error Handling',
    description: 'AI-powered analysis of error handling patterns and anti-patterns',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
