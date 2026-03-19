import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import gitlog from 'gitlog';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AuthorCommitCount {
  author: string;
  count: number;
}

interface FileChurn {
  file: string;
  commits: number;
}

interface TodoEntry {
  file: string;
  line: number;
  text: string;
  ageInDays: number;
}

/**
 * Collect all directories (one level deep) for staleness analysis.
 */
function getTopLevelDirs(repoPath: string): string[] {
  const exclude = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    'out',
    'coverage',
    '.turbo',
    '.vercel',
  ]);

  try {
    const entries = readdirSync(repoPath, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
    return entries
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !exclude.has(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sub-analyses
// ---------------------------------------------------------------------------

/**
 * Bus factor: identify files where >80% of commits come from a single author.
 */
async function analyzeBusFactor(
  repoPath: string
): Promise<{ findings: Finding[]; authorDiversity: number }> {
  const findings: Finding[] = [];

  let commits;
  try {
    commits = await gitlog({
      repo: repoPath,
      number: 1000,
      fields: ['authorName'] as const,
      nameStatus: true,
    });
  } catch {
    return { findings: [], authorDiversity: 1.0 };
  }

  if (commits.length === 0) {
    return { findings: [], authorDiversity: 1.0 };
  }

  // Map file -> author -> commit count
  const fileAuthors = new Map<string, Map<string, number>>();
  const allAuthors = new Set<string>();

  for (const commit of commits) {
    const author = commit.authorName;
    allAuthors.add(author);

    if (commit.files) {
      for (const file of commit.files) {
        if (!file || file === '') continue;
        if (!fileAuthors.has(file)) {
          fileAuthors.set(file, new Map());
        }
        const authors = fileAuthors.get(file)!;
        authors.set(author, (authors.get(author) ?? 0) + 1);
      }
    }
  }

  let siloCount = 0;
  let totalFilesAnalyzed = 0;

  for (const [file, authors] of fileAuthors.entries()) {
    const totalCommits = Array.from(authors.values()).reduce(
      (sum, c) => sum + c,
      0
    );
    if (totalCommits < 3) continue; // Skip files with very few commits
    totalFilesAnalyzed++;

    // Find dominant author
    let maxAuthor = '';
    let maxCount = 0;
    for (const [author, count] of authors.entries()) {
      if (count > maxCount) {
        maxAuthor = author;
        maxCount = count;
      }
    }

    const dominance = maxCount / totalCommits;
    if (dominance > 0.8) {
      siloCount++;
      const message = `Knowledge silo: ${Math.round(dominance * 100)}% of commits by "${maxAuthor}" (${maxCount}/${totalCommits} commits)`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: dominance > 0.95 ? 'medium' : 'low',
        filePath: file,
        message,
        category: 'bus-factor',
        suggestion: `Encourage code review and pair programming on this file to spread knowledge.`,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('git-health', finding),
      });
    }
  }

  // Author diversity: ratio of non-silo files
  const authorDiversity =
    totalFilesAnalyzed > 0
      ? (totalFilesAnalyzed - siloCount) / totalFilesAnalyzed
      : 1.0;

  return { findings, authorDiversity };
}

/**
 * Churn hotspots: files with the most commits.
 */
async function analyzeChurn(
  repoPath: string
): Promise<{ findings: Finding[]; churnHealth: number }> {
  const findings: Finding[] = [];

  let commits;
  try {
    commits = await gitlog({
      repo: repoPath,
      number: 1000,
      fields: ['hash'] as const,
      nameStatus: true,
    });
  } catch {
    return { findings: [], churnHealth: 1.0 };
  }

  if (commits.length === 0) {
    return { findings: [], churnHealth: 1.0 };
  }

  // Count commits per file
  const fileCounts = new Map<string, number>();
  for (const commit of commits) {
    if (commit.files) {
      for (const file of commit.files) {
        if (!file || file === '') continue;
        fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
      }
    }
  }

  const entries: FileChurn[] = Array.from(fileCounts.entries())
    .map(([file, commits]) => ({ file, commits }))
    .sort((a, b) => b.commits - a.commits);

  if (entries.length === 0) {
    return { findings: [], churnHealth: 1.0 };
  }

  // Top 10% by churn = high churn
  const highChurnThreshold = Math.max(
    1,
    Math.floor(entries.length * 0.1)
  );
  const highChurnFiles = entries.slice(0, highChurnThreshold);

  for (const { file, commits: commitCount } of highChurnFiles) {
    const message = `High churn: ${commitCount} commits (top 10% of changed files)`;
    const severity: Severity = commitCount > 50 ? 'medium' : 'low';

    const finding: Omit<Finding, 'id' | 'fingerprint'> = {
      severity,
      filePath: file,
      message,
      category: 'churn-hotspot',
      suggestion: `High-churn files may benefit from refactoring or splitting to reduce change frequency.`,
    };

    findings.push({
      ...finding,
      id: nanoid(),
      fingerprint: generateFingerprint('git-health', finding),
    });
  }

  // Churn health: lower is worse (more high-churn files relative to total)
  const churnHealth = 1 - highChurnFiles.length / entries.length;

  return { findings, churnHealth };
}

/**
 * TODO age: find TODOs/FIXMEs and check how old they are via git blame.
 */
function analyzeTodoAge(
  repoPath: string
): { findings: Finding[]; todoScore: number } {
  const findings: Finding[] = [];

  // Find TODOs with git grep
  let grepOutput = '';
  try {
    grepOutput = execSync('git grep -n "TODO\\|FIXME"', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    // git grep exits 1 when no matches found
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof (error as { stdout: unknown }).stdout === 'string'
    ) {
      grepOutput = (error as { stdout: string }).stdout;
    }
    if (!grepOutput) {
      return { findings: [], todoScore: 1.0 };
    }
  }

  const lines = grepOutput.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    return { findings: [], todoScore: 1.0 };
  }

  const todos: TodoEntry[] = [];
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  // Limit to first 100 TODOs to avoid slowness
  const linesToProcess = lines.slice(0, 100);

  for (const line of linesToProcess) {
    // Format: file:lineNumber:content
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;

    const [, file, lineNumStr, text] = match;
    const lineNum = parseInt(lineNumStr!, 10);

    // Get blame date for this line
    let blameDate: Date | null = null;
    try {
      const blameOutput = execSync(
        `git blame -L ${lineNum},${lineNum} --porcelain "${file}"`,
        {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 5_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      // Look for author-time (epoch seconds)
      const timeMatch = blameOutput.match(/^author-time\s+(\d+)/m);
      if (timeMatch) {
        blameDate = new Date(parseInt(timeMatch[1]!, 10) * 1000);
      }
    } catch {
      // Skip if blame fails
      continue;
    }

    if (!blameDate) continue;

    const ageMs = now - blameDate.getTime();
    const ageInDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    todos.push({ file: file!, line: lineNum, text: text!.trim(), ageInDays });

    if (ageMs > ninetyDaysMs) {
      const message = `Stale TODO (${ageInDays} days old): ${text!.trim().slice(0, 80)}`;
      const severity: Severity = ageInDays > 365 ? 'medium' : 'low';

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath: file!,
        line: lineNum,
        message,
        category: 'stale-todo',
        suggestion: `This TODO has been open for ${ageInDays} days. Either address it or remove it if no longer relevant.`,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('git-health', finding),
      });
    }
  }

  // Score: ratio of non-stale TODOs
  const staleTodos = todos.filter(
    (t) => t.ageInDays > 90
  ).length;
  const todoScore =
    todos.length > 0 ? (todos.length - staleTodos) / todos.length : 1.0;

  return { findings, todoScore };
}

/**
 * Stale areas: directories with no commits in last 6 months.
 */
function analyzeStaleAreas(
  repoPath: string
): { findings: Finding[]; freshnessScore: number } {
  const findings: Finding[] = [];
  const dirs = getTopLevelDirs(repoPath);

  if (dirs.length === 0) {
    return { findings: [], freshnessScore: 1.0 };
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

  let staleCount = 0;

  for (const dir of dirs) {
    try {
      const output = execSync(
        `git log --since="${sixMonthsAgoStr}" --oneline -- "${dir}" | head -1`,
        {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 10_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      if (!output.trim()) {
        staleCount++;

        // Get last commit date for this dir
        let lastCommitDate = 'unknown';
        try {
          const lastCommit = execSync(
            `git log -1 --format="%ai" -- "${dir}"`,
            {
              cwd: repoPath,
              encoding: 'utf-8',
              timeout: 5_000,
              stdio: ['pipe', 'pipe', 'pipe'],
            }
          );
          if (lastCommit.trim()) {
            lastCommitDate = lastCommit.trim().split(' ')[0] ?? 'unknown';
          }
        } catch {
          // ignore
        }

        const message = `Stale directory: no commits in 6+ months (last activity: ${lastCommitDate})`;
        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity: 'low',
          filePath: dir,
          message,
          category: 'stale-area',
          suggestion: `This directory hasn't been touched in over 6 months. It may contain dead code or abandoned features.`,
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('git-health', finding),
        });
      }
    } catch {
      // Skip dirs where git log fails
    }
  }

  const freshnessScore =
    dirs.length > 0 ? (dirs.length - staleCount) / dirs.length : 1.0;

  return { findings, freshnessScore };
}

// ---------------------------------------------------------------------------
// Module runner
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, '.git'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    const allFindings: Finding[] = [];
    const metrics: Record<string, number> = {};

    // 1. Bus factor (30%)
    opts.onProgress?.(5, 'Analyzing bus factor...');
    let authorDiversity = 1.0;
    try {
      const busFactor = await analyzeBusFactor(repoPath);
      allFindings.push(...busFactor.findings);
      authorDiversity = busFactor.authorDiversity;
      metrics.busFactor = Math.round(authorDiversity * 100);
      metrics.knowledgeSiloFiles = busFactor.findings.length;
    } catch {
      metrics.busFactor = -1;
    }

    // 2. Churn (30%)
    opts.onProgress?.(30, 'Analyzing churn hotspots...');
    let churnHealth = 1.0;
    try {
      const churn = await analyzeChurn(repoPath);
      allFindings.push(...churn.findings);
      churnHealth = churn.churnHealth;
      metrics.churnHealth = Math.round(churnHealth * 100);
      metrics.highChurnFiles = churn.findings.length;
    } catch {
      metrics.churnHealth = -1;
    }

    // 3. TODO age (20%)
    opts.onProgress?.(55, 'Analyzing TODO/FIXME age...');
    let todoScore = 1.0;
    try {
      const todos = analyzeTodoAge(repoPath);
      allFindings.push(...todos.findings);
      todoScore = todos.todoScore;
      metrics.todoScore = Math.round(todoScore * 100);
      metrics.staleTodos = todos.findings.length;
    } catch {
      metrics.todoScore = -1;
    }

    // 4. Stale areas (20%)
    opts.onProgress?.(80, 'Analyzing stale areas...');
    let freshnessScore = 1.0;
    try {
      const stale = analyzeStaleAreas(repoPath);
      allFindings.push(...stale.findings);
      freshnessScore = stale.freshnessScore;
      metrics.freshness = Math.round(freshnessScore * 100);
      metrics.staleDirectories = stale.findings.length;
    } catch {
      metrics.freshness = -1;
    }

    // Composite score: weighted combination
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          authorDiversity * 30 +
            churnHealth * 30 +
            todoScore * 20 +
            freshnessScore * 20
        )
      )
    );

    metrics.totalFindings = allFindings.length;

    opts.onProgress?.(100, 'Git health analysis complete.');

    const summaryParts: string[] = [];
    summaryParts.push(`Git health score: ${score}/100.`);
    if (metrics.knowledgeSiloFiles > 0) {
      summaryParts.push(
        `${metrics.knowledgeSiloFiles} knowledge silo files detected.`
      );
    }
    if (metrics.highChurnFiles > 0) {
      summaryParts.push(`${metrics.highChurnFiles} high-churn hotspots.`);
    }
    if (metrics.staleTodos > 0) {
      summaryParts.push(`${metrics.staleTodos} stale TODOs (>90 days).`);
    }
    if (metrics.staleDirectories > 0) {
      summaryParts.push(
        `${metrics.staleDirectories} stale directories (>6 months).`
      );
    }

    return {
      score,
      confidence: 0.9,
      findings: allFindings,
      metrics,
      summary: summaryParts.join(' '),
    };
  },
};

registerModule(
  {
    id: 'git-health',
    name: 'Git Health',
    description:
      'Git history analysis: bus factor, churn, TODOs, staleness',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
