import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { getProvider } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import { selectFilesForAnalysis } from '@/lib/ai/sampling';
import {
  DOC_ACCURACY_SYSTEM,
  buildDocAccuracyPrompt,
} from '@/lib/ai/prompts/doc-accuracy';
import type { DocAccuracyInput } from '@/lib/ai/prompts/doc-accuracy';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'doc-accuracy';

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
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

/**
 * Well-known documentation file names to look for at the repo root.
 */
const ROOT_DOC_FILES = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'PLAN.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'ARCHITECTURE.md',
];

/**
 * Collect documentation files: well-known root docs + docs/ directory + any
 * CLAUDE.md / AGENTS.md scattered in subdirectories.
 */
function collectDocFiles(repoPath: string): string[] {
  const docs: string[] = [];

  // Root-level well-known files
  for (const name of ROOT_DOC_FILES) {
    const full = join(repoPath, name);
    if (existsSync(full)) {
      docs.push(name);
    }
  }

  // docs/ directory (one level deep)
  const docsDir = join(repoPath, 'docs');
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
    try {
      for (const entry of readdirSync(docsDir)) {
        if (entry.endsWith('.md')) {
          docs.push(join('docs', entry));
        }
      }
    } catch {
      // ignore read errors
    }
  }

  // Scan for CLAUDE.md and AGENTS.md in subdirectories (max 2 levels deep)
  try {
    for (const dir of readdirSync(repoPath)) {
      if (dir === 'node_modules' || dir === '.git' || dir === 'docs') continue;
      const subPath = join(repoPath, dir);
      if (!statSync(subPath).isDirectory()) continue;

      for (const docName of ['CLAUDE.md', 'AGENTS.md']) {
        const candidate = join(subPath, docName);
        const relPath = join(dir, docName);
        if (existsSync(candidate) && !docs.includes(relPath)) {
          docs.push(relPath);
        }
      }

      // One more level
      try {
        for (const sub2 of readdirSync(subPath)) {
          const sub2Path = join(subPath, sub2);
          if (!statSync(sub2Path).isDirectory()) continue;
          for (const docName of ['CLAUDE.md', 'AGENTS.md']) {
            const candidate = join(sub2Path, docName);
            const relPath = join(dir, sub2, docName);
            if (existsSync(candidate) && !docs.includes(relPath)) {
              docs.push(relPath);
            }
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return docs;
}

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

    const tracker = createTokenTracker(30_000);

    opts.onProgress?.(5, 'Collecting documentation files...');

    const docPaths = collectDocFiles(repoPath);

    if (docPaths.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { docsAnalyzed: 0, sourceFilesAnalyzed: 0 },
        summary: 'No documentation files found for accuracy analysis.',
      };
    }

    opts.onProgress?.(10, `Found ${docPaths.length} doc files. Selecting source files for comparison...`);

    // Read doc files
    const docInputs: DocAccuracyInput[] = [];
    for (const docPath of docPaths) {
      const fullPath = join(repoPath, docPath);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
      const ext = extname(docPath);
      docInputs.push({
        filePath: docPath,
        content,
        language: LANGUAGE_MAP[ext] ?? 'markdown',
      });
    }

    if (docInputs.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { docsAnalyzed: 0, sourceFilesAnalyzed: 0 },
        summary: 'Could not read any documentation files.',
      };
    }

    // Sample source files for comparison
    const sampledFiles = await selectFilesForAnalysis(repoPath, [], 20);

    opts.onProgress?.(15, `Analyzing ${docInputs.length} docs against ${sampledFiles.length} source files...`);

    // Read source files
    const sourceInputs: DocAccuracyInput[] = [];
    for (const sampled of sampledFiles) {
      const fullPath = join(repoPath, sampled.filePath);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
      const ext = extname(sampled.filePath);
      sourceInputs.push({
        filePath: sampled.filePath,
        content,
        language: LANGUAGE_MAP[ext] ?? 'typescript',
      });
    }

    const allFindings: Finding[] = [];

    // Batch doc files in groups of 3 (docs are typically larger than source),
    // sending all source files with each batch for context
    const batchSize = 3;
    for (let i = 0; i < docInputs.length; i += batchSize) {
      if (opts.signal?.aborted) break;
      if (tracker.isExhausted()) break;

      const docBatch = docInputs.slice(i, i + batchSize);
      const userPrompt = buildDocAccuracyPrompt(docBatch, sourceInputs);

      try {
        const response = await provider.query(userPrompt, {
          model: getModelForModule(MODULE_ID),
          maxTokens: 4096,
          system: DOC_ACCURACY_SYSTEM,
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
              message: f.message ?? 'Documentation inaccuracy',
              category: 'doc-accuracy',
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

      const progress = 15 + Math.round(((i + batchSize) / docInputs.length) * 75);
      opts.onProgress?.(Math.min(progress, 90), `Processed ${Math.min(i + batchSize, docInputs.length)} of ${docInputs.length} doc files...`);
    }

    opts.onProgress?.(95, 'Computing doc accuracy score...');

    // Scoring: start at 100, deduct per finding
    let score = 100;
    for (const f of allFindings) {
      score -= SEVERITY_DEDUCTIONS[f.severity] ?? 2;
    }
    score = Math.max(0, score);

    const usage = tracker.getUsage();

    const metrics: Record<string, number> = {
      docsAnalyzed: docInputs.length,
      sourceFilesAnalyzed: sourceInputs.length,
      findingsCount: allFindings.length,
      tokensUsed: usage.totalTokens,
    };

    const summary = allFindings.length > 0
      ? `Found ${allFindings.length} documentation accuracy issues across ${docInputs.length} doc files. Score: ${score}/100.`
      : `No documentation accuracy issues found in ${docInputs.length} doc files analyzed.`;

    opts.onProgress?.(100, 'Documentation accuracy analysis complete.');

    return {
      score,
      confidence: 0.7,
      findings: allFindings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Doc Accuracy',
    description: 'AI-powered analysis of documentation accuracy against actual code structure',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
