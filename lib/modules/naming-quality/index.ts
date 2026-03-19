import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { getProvider } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import { selectFilesForAnalysis } from '@/lib/ai/sampling';
import {
  NAMING_QUALITY_SYSTEM,
  buildNamingQualityPrompt,
} from '@/lib/ai/prompts/naming-quality';
import type { NamingQualityInput } from '@/lib/ai/prompts/naming-quality';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'naming-quality';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 8,
  high: 8,
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

    opts.onProgress?.(5, 'Selecting files for naming analysis...');

    // selectFilesForAnalysis needs prior module results; we pass empty since
    // AI modules run after static modules in the orchestrator, but we don't
    // have access to them here. The sampling function handles empty gracefully.
    const sampledFiles = await selectFilesForAnalysis(repoPath, [], 20);

    if (sampledFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { filesAnalyzed: 0 },
        summary: 'No source files found for naming analysis.',
      };
    }

    opts.onProgress?.(15, `Analyzing naming in ${sampledFiles.length} files...`);

    const allFindings: Finding[] = [];

    // Batch files in groups of 5 for efficiency
    const batchSize = 5;
    for (let i = 0; i < sampledFiles.length; i += batchSize) {
      if (opts.signal?.aborted) break;
      if (tracker.isExhausted()) break;

      const batch = sampledFiles.slice(i, i + batchSize);
      const inputs: NamingQualityInput[] = [];

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

      const userPrompt = buildNamingQualityPrompt(inputs);

      try {
        const response = await provider.query(userPrompt, {
          model: getModelForModule(MODULE_ID),
          maxTokens: 4096,
          system: NAMING_QUALITY_SYSTEM,
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
              message: f.message ?? 'Naming issue',
              category: 'naming',
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
        // API error for this batch — continue with remaining batches
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

    opts.onProgress?.(95, 'Computing naming quality score...');

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
      ? `Found ${allFindings.length} naming issues across ${sampledFiles.length} files. Score: ${score}/100.`
      : `No naming issues found in ${sampledFiles.length} files analyzed.`;

    opts.onProgress?.(100, 'Naming quality analysis complete.');

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
    name: 'Naming Quality',
    description: 'AI-powered analysis of naming conventions and identifier quality',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
