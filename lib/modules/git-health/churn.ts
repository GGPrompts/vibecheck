import gitlog from 'gitlog';
import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding, Severity } from '../types';

interface FileChurn {
  file: string;
  commits: number;
}

/**
 * Churn hotspots: files with the most commits.
 */
export async function analyzeChurn(
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
