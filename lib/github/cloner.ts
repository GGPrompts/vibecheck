import { execSync } from 'child_process';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CloneResult {
  path: string;
  sha: string;
  owner: string;
  repo: string;
  cleanup: () => void;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parses a GitHub repo identifier into owner and repo.
 * Supports:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - github.com/owner/repo
 *   - owner/repo
 */
export function parseGitHubRepo(input: string): { owner: string; repo: string } {
  const cleaned = input.trim().replace(/\.git$/, '').replace(/\/$/, '');

  // Full URL: https://github.com/owner/repo
  const urlMatch = cleaned.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // No protocol: github.com/owner/repo
  const noProtoMatch = cleaned.match(/^github\.com\/([^/]+)\/([^/]+)$/);
  if (noProtoMatch) {
    return { owner: noProtoMatch[1], repo: noProtoMatch[2] };
  }

  // Short form: owner/repo
  const shortMatch = cleaned.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  throw new Error(
    `Invalid GitHub repo URL: "${input}". Expected formats: https://github.com/owner/repo, github.com/owner/repo, or owner/repo`,
  );
}

// ---------------------------------------------------------------------------
// cloneRepo
// ---------------------------------------------------------------------------

export async function cloneRepo(repoUrl: string): Promise<CloneResult> {
  const { owner, repo } = parseGitHubRepo(repoUrl);
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  const baseDir = join(homedir(), '.vibecheck', 'clones');
  mkdirSync(baseDir, { recursive: true });

  const targetDir = join(baseDir, `${owner}-${repo}`);

  // Clean up any previous clone at this path
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  try {
    execSync(`git clone --depth 1 ${cloneUrl} ${JSON.stringify(targetDir)}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found') || message.includes('does not exist')) {
      throw new Error(`Repository not found: ${owner}/${repo}`);
    }
    throw new Error(`Failed to clone ${owner}/${repo}: ${message}`);
  }

  let sha: string;
  try {
    sha = execSync('git rev-parse HEAD', {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Failed to read HEAD SHA from cloned repo at ${targetDir}`);
  }

  const cleanup = () => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
  };

  return { path: targetDir, sha, owner, repo, cleanup };
}
