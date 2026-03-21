import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding } from '../types';

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

/**
 * Stale areas: directories with no commits in last 6 months.
 */
export function analyzeStaleAreas(
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
