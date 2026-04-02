import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export function createRepoFixture(
  files: Record<string, string>,
): string {
  const root = mkdtempSync(join(tmpdir(), 'vibecheck-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(join(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}
