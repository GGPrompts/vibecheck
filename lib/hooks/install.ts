import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { join, resolve } from 'path';

const HOOK_MARKER = '# vibecheck post-commit hook';

function getHookPath(repoPath: string): string {
  return join(repoPath, '.git', 'hooks', 'post-commit');
}

/**
 * Generate the hook script content.
 * Runs snapshot.js in the background so it never blocks `git commit`.
 */
function buildHookScript(repoPath: string): string {
  // Resolve the vibecheck project root (two levels up from lib/hooks/)
  const vibecheckRoot = resolve(__dirname, '..', '..');
  const snapshotScript = join(vibecheckRoot, 'lib', 'hooks', 'snapshot.js');

  return [
    '',
    HOOK_MARKER,
    `node "${snapshotScript}" "${repoPath}" >/dev/null 2>&1 &`,
    '# end vibecheck hook',
  ].join('\n');
}

/**
 * Install a post-commit hook that triggers a fast vibecheck scan.
 * Idempotent: safe to call multiple times. Appends to existing hooks.
 */
export function installHook(repoPath: string): { success: boolean; message: string } {
  try {
    const hookPath = getHookPath(repoPath);
    const gitDir = join(repoPath, '.git');

    if (!existsSync(gitDir)) {
      return { success: false, message: 'Not a git repository (no .git directory)' };
    }

    // Ensure hooks directory exists
    const hooksDir = join(gitDir, 'hooks');
    if (!existsSync(hooksDir)) {
      const { mkdirSync } = require('fs');
      mkdirSync(hooksDir, { recursive: true });
    }

    // If hook already contains our marker, it's already installed
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, 'utf-8');
      if (existing.includes(HOOK_MARKER)) {
        return { success: true, message: 'Hook already installed' };
      }

      // Append our hook to the existing post-commit hook
      const updated = existing.trimEnd() + '\n' + buildHookScript(repoPath) + '\n';
      writeFileSync(hookPath, updated, 'utf-8');
      chmodSync(hookPath, 0o755);
      return { success: true, message: 'Hook appended to existing post-commit hook' };
    }

    // Create a new post-commit hook
    const content = '#!/bin/sh\n' + buildHookScript(repoPath) + '\n';
    writeFileSync(hookPath, content, 'utf-8');
    chmodSync(hookPath, 0o755);
    return { success: true, message: 'Hook installed successfully' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to install hook: ${msg}` };
  }
}

/**
 * Remove the vibecheck post-commit hook.
 * If the hook file contains only our hook, the file is deleted.
 * If it contains other hooks too, only our section is removed.
 */
export function uninstallHook(repoPath: string): { success: boolean; message: string } {
  try {
    const hookPath = getHookPath(repoPath);

    if (!existsSync(hookPath)) {
      return { success: true, message: 'No post-commit hook found' };
    }

    const content = readFileSync(hookPath, 'utf-8');
    if (!content.includes(HOOK_MARKER)) {
      return { success: true, message: 'Vibecheck hook not found in post-commit' };
    }

    // Remove our section (from marker to end-marker, inclusive)
    const lines = content.split('\n');
    const filtered: string[] = [];
    let inVibecheckBlock = false;

    for (const line of lines) {
      if (line.trim() === HOOK_MARKER) {
        inVibecheckBlock = true;
        continue;
      }
      if (inVibecheckBlock && line.trim() === '# end vibecheck hook') {
        inVibecheckBlock = false;
        continue;
      }
      if (!inVibecheckBlock) {
        filtered.push(line);
      }
    }

    const remaining = filtered.join('\n').trim();

    // If only the shebang (or nothing) remains, delete the file
    if (!remaining || remaining === '#!/bin/sh') {
      unlinkSync(hookPath);
      return { success: true, message: 'Hook removed (file deleted)' };
    }

    writeFileSync(hookPath, remaining + '\n', 'utf-8');
    chmodSync(hookPath, 0o755);
    return { success: true, message: 'Vibecheck hook removed from post-commit' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to uninstall hook: ${msg}` };
  }
}

/**
 * Check whether the vibecheck post-commit hook is installed.
 */
export function isHookInstalled(repoPath: string): boolean {
  const hookPath = getHookPath(repoPath);
  if (!existsSync(hookPath)) return false;
  const content = readFileSync(hookPath, 'utf-8');
  return content.includes(HOOK_MARKER);
}
