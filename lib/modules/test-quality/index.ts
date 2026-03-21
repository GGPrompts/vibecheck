import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { getProvider } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import {
  TEST_QUALITY_SYSTEM,
  buildTestQualityPrompt,
} from '@/lib/ai/prompts/test-quality';
import type { TestQualityInput } from '@/lib/ai/prompts/test-quality';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'test-quality';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', 'out', '.git',
  'coverage', '.turbo', '.vercel', '__pycache__', '.cache',
]);

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.[jt]sx?$/,
];

/**
 * Recursively collect test files from the repo.
 */
function collectTestFiles(dir: string, files: string[] = []): string[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      // Include __tests__ directories
      collectTestFiles(fullPath, files);
    } else if (entry.isFile()) {
      const isTestFile = TEST_FILE_PATTERNS.some((p) => p.test(entry.name));
      // Also include files inside __tests__ directories
      const inTestDir = dir.includes('__tests__');
      if (isTestFile || (inTestDir && /\.[jt]sx?$/.test(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    const provider = await getProvider();
    if (!(await provider.isAvailable())) return false;
    // Check if repo has any test files
    const testFiles = collectTestFiles(repoPath);
    return testFiles.length > 0;
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

    opts.onProgress?.(5, 'Discovering test files...');

    const allTestFiles = collectTestFiles(repoPath);

    if (allTestFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { testFilesAnalyzed: 0 },
        summary: 'No test files found.',
      };
    }

    // Select top 10 test files by size (larger files more likely to have issues)
    const filesWithSize = allTestFiles
      .map((f) => {
        try {
          return { path: f, size: statSync(f).size };
        } catch {
          return { path: f, size: 0 };
        }
      })
      .sort((a, b) => b.size - a.size)
      .slice(0, 10);

    opts.onProgress?.(15, `Analyzing ${filesWithSize.length} test files...`);

    const allFindings: Finding[] = [];

    // Batch test files in groups of 5
    const batchSize = 5;
    for (let i = 0; i < filesWithSize.length; i += batchSize) {
      if (opts.signal?.aborted) break;
      if (tracker.isExhausted()) break;

      const batch = filesWithSize.slice(i, i + batchSize);
      const testFileInputs: TestQualityInput['testFiles'] = [];

      for (const file of batch) {
        let content: string;
        try {
          content = readFileSync(file.path, 'utf-8');
        } catch {
          continue;
        }
        const relPath = file.path.replace(repoPath + '/', '');
        testFileInputs.push({
          filePath: relPath,
          content,
        });
      }

      if (testFileInputs.length === 0) continue;

      const input: TestQualityInput = {
        testFiles: testFileInputs,
      };

      const userPrompt = buildTestQualityPrompt(input);

      try {
        const response = await provider.query(userPrompt, {
          model: getModelForModule(MODULE_ID),
          maxTokens: 4096,
          system: TEST_QUALITY_SYSTEM,
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
              message: f.message ?? 'Test quality issue',
              category: 'test-quality',
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
        if (err instanceof Error && err.message.includes('abort')) {
          break;
        }
        // Swallow other API errors and continue
      }

      const progress = 15 + Math.round(((i + batchSize) / filesWithSize.length) * 75);
      opts.onProgress?.(Math.min(progress, 90), `Processed ${Math.min(i + batchSize, filesWithSize.length)} of ${filesWithSize.length} test files...`);
    }

    opts.onProgress?.(95, 'Computing test quality score...');

    // Scoring: 100 - deductions per finding
    let score = 100;
    for (const f of allFindings) {
      score -= SEVERITY_DEDUCTIONS[f.severity] ?? 2;
    }
    score = Math.max(0, score);

    const usage = tracker.getUsage();

    const metrics: Record<string, number> = {
      totalTestFiles: allTestFiles.length,
      testFilesAnalyzed: filesWithSize.length,
      findingsCount: allFindings.length,
      tokensUsed: usage.totalTokens,
    };

    const summary = allFindings.length > 0
      ? `Found ${allFindings.length} test quality issues across ${filesWithSize.length} test files. Score: ${score}/100.`
      : `No test quality issues found in ${filesWithSize.length} test files analyzed.`;

    opts.onProgress?.(100, 'Test quality analysis complete.');

    return {
      score,
      confidence: 0.70,
      findings: allFindings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Test Quality',
    description: 'AI-powered analysis of test effectiveness and quality',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
