import { execSync } from 'child_process';
import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding, Severity } from '../types';

interface TodoEntry {
  file: string;
  line: number;
  text: string;
  ageInDays: number;
}

/**
 * TODO age: find TODOs/FIXMEs and check how old they are via git blame.
 */
export function analyzeTodoAge(
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
