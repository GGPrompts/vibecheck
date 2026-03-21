import gitlog from 'gitlog';
import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding } from '../types';

/**
 * Bus factor: identify files where >80% of commits come from a single author.
 */
export async function analyzeBusFactor(
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
