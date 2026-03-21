import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding } from '../types';

// ---------------------------------------------------------------------------
// Patterns that reference external knowledge silos
// ---------------------------------------------------------------------------

/**
 * Regex patterns matching comments/docs that point to external systems where
 * critical context lives outside the repo.
 */
const EXTERNAL_REF_PATTERNS: { pattern: RegExp; system: string }[] = [
  { pattern: /see\s+notion/i, system: 'Notion' },
  { pattern: /per\s+slack\s+discussion/i, system: 'Slack' },
  { pattern: /see\s+slack/i, system: 'Slack' },
  { pattern: /see\s+wiki/i, system: 'Wiki' },
  { pattern: /see\s+confluence/i, system: 'Confluence' },
  { pattern: /see\s+jira/i, system: 'Jira' },
  { pattern: /per\s+jira/i, system: 'Jira' },
  { pattern: /per\s+confluence/i, system: 'Confluence' },
  { pattern: /per\s+notion/i, system: 'Notion' },
  { pattern: /documented\s+in\s+(notion|confluence|jira|wiki|slack)/i, system: '$1' },
];

/**
 * URL patterns in markdown/docs that link to external knowledge platforms.
 */
const EXTERNAL_LINK_PATTERNS: { pattern: RegExp; system: string }[] = [
  { pattern: /https?:\/\/[^\s)]*notion\.so/i, system: 'Notion' },
  { pattern: /https?:\/\/[^\s)]*\.atlassian\.net\/wiki/i, system: 'Confluence' },
  { pattern: /https?:\/\/[^\s)]*\.atlassian\.net\/browse/i, system: 'Jira' },
  { pattern: /https?:\/\/[^\s)]*confluence\.[^\s)]*/i, system: 'Confluence' },
  { pattern: /https?:\/\/[^\s)]*jira\.[^\s)]*/i, system: 'Jira' },
];

// File extensions to scan for inline comments
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh',
]);

// Doc files to scan for external links
const DOC_FILENAMES = new Set([
  'readme.md', 'readme.txt', 'readme',
  'claude.md', 'agents.md',
  'contributing.md', 'architecture.md',
  'docs.md', 'changelog.md',
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst']);

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  'coverage', '.turbo', '.vercel', 'vendor', '__pycache__',
]);

// Max file size to scan (256 KB)
const MAX_FILE_SIZE = 256 * 1024;

// Max files to scan total
const MAX_FILES = 500;

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function collectFiles(
  repoPath: string,
  maxFiles: number
): { codePaths: string[]; docPaths: string[] } {
  const codePaths: string[] = [];
  const docPaths: string[] = [];
  let totalCollected = 0;

  function walk(dir: string): void {
    if (totalCollected >= maxFiles) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (totalCollected >= maxFiles) return;

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(join(dir, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const fullPath = join(dir, entry.name);
      const relPath = relative(repoPath, fullPath);
      const nameLower = entry.name.toLowerCase();
      const ext = nameLower.slice(nameLower.lastIndexOf('.'));

      // Check file size
      try {
        const stat = statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
      } catch {
        continue;
      }

      if (DOC_FILENAMES.has(nameLower) || DOC_EXTENSIONS.has(ext)) {
        docPaths.push(relPath);
        totalCollected++;
      } else if (CODE_EXTENSIONS.has(ext)) {
        codePaths.push(relPath);
        totalCollected++;
      }
    }
  }

  walk(repoPath);
  return { codePaths, docPaths };
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

interface ExternalSiloMatch {
  file: string;
  line: number;
  system: string;
  text: string;
}

function scanFileForExternalRefs(
  repoPath: string,
  filePath: string,
  isDoc: boolean
): ExternalSiloMatch[] {
  const matches: ExternalSiloMatch[] = [];
  const fullPath = join(repoPath, filePath);

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split('\n');
  const patterns = isDoc
    ? [...EXTERNAL_REF_PATTERNS, ...EXTERNAL_LINK_PATTERNS]
    : EXTERNAL_REF_PATTERNS;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { pattern, system } of patterns) {
      if (pattern.test(line)) {
        // Resolve dynamic system name from capture group
        const resolvedSystem = system === '$1'
          ? (line.match(pattern)?.[1] ?? system)
          : system;

        matches.push({
          file: filePath,
          line: i + 1,
          system: resolvedSystem.charAt(0).toUpperCase() + resolvedSystem.slice(1),
          text: line.trim().slice(0, 120),
        });
        break; // One match per line is enough
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect references to external knowledge silos (Notion, Slack, Confluence,
 * Jira, wikis) in code comments and documentation files. Critical project
 * context should live in the repo, not in external systems that may become
 * stale or inaccessible.
 */
export function analyzeExternalSilos(
  repoPath: string
): { findings: Finding[]; siloScore: number } {
  const findings: Finding[] = [];
  const { codePaths, docPaths } = collectFiles(repoPath, MAX_FILES);

  const allMatches: ExternalSiloMatch[] = [];

  // Scan doc files first (more likely to have external links)
  for (const docPath of docPaths) {
    allMatches.push(...scanFileForExternalRefs(repoPath, docPath, true));
  }

  // Scan code files for comment references
  for (const codePath of codePaths) {
    allMatches.push(...scanFileForExternalRefs(repoPath, codePath, false));
  }

  // Deduplicate by file+system (report once per file per system)
  const seen = new Set<string>();
  const deduped: ExternalSiloMatch[] = [];
  for (const match of allMatches) {
    const key = `${match.file}::${match.system}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(match);
    }
  }

  for (const match of deduped) {
    const message = `External knowledge silo: references ${match.system} — "${match.text}"`;

    const finding: Omit<Finding, 'id' | 'fingerprint'> = {
      severity: 'medium',
      filePath: match.file,
      line: match.line,
      message,
      category: 'external-silo',
      suggestion: `Critical context referenced in ${match.system} should be captured in repo documentation (README, CLAUDE.md, inline comments) so it remains accessible to all contributors and AI agents.`,
    };

    findings.push({
      ...finding,
      id: nanoid(),
      fingerprint: generateFingerprint('git-health', finding),
    });
  }

  // Score: penalize proportionally to the number of external silo references.
  // 0 refs = 1.0, 5+ refs = 0.0 (linear scale capped at 5)
  const totalFiles = codePaths.length + docPaths.length;
  const siloScore =
    totalFiles > 0
      ? Math.max(0, 1 - deduped.length / Math.max(5, deduped.length))
      : 1.0;

  return { findings, siloScore };
}
