/**
 * Hook install/uninstall action for the CLI.
 * Invoked via tsx by bin/vibecheck.mjs when --hook flag is used.
 *
 * Usage: tsx hook-action.ts <install|uninstall> <repoPath>
 */

import { installHook, uninstallHook, isHookInstalled } from '@/lib/hooks/install';

const action = process.argv[2];
const repoPath = process.argv[3];

if (!action || !repoPath) {
  console.error('Usage: hook-action.ts <install|uninstall> <repoPath>');
  process.exit(1);
}

if (action === 'install') {
  const result = installHook(repoPath);
  if (result.success) {
    console.log(result.message);
    if (isHookInstalled(repoPath)) {
      console.log('Health snapshots will be recorded to .vibecheck/commit-health.jsonl after each commit.');
    }
  } else {
    console.error(result.message);
    process.exit(1);
  }
} else if (action === 'uninstall') {
  const result = uninstallHook(repoPath);
  if (result.success) {
    console.log(result.message);
  } else {
    console.error(result.message);
    process.exit(1);
  }
} else {
  console.error(`Unknown hook action: ${action}. Use "install" or "uninstall".`);
  process.exit(1);
}
