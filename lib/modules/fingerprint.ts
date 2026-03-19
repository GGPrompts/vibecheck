import { createHash } from 'crypto';

/**
 * Generate a stable fingerprint for a finding. Uses SHA-256 of
 * moduleId + filePath + category + first 100 chars of message.
 *
 * Line number is intentionally excluded because lines shift between edits,
 * but the finding itself (same file, same category, same message) is still
 * the same logical issue.
 */
export function generateFingerprint(
  moduleId: string,
  finding: {
    filePath: string;
    line?: number;
    category: string;
    message: string;
  }
): string {
  const content = [
    moduleId,
    finding.filePath,
    finding.category,
    finding.message.slice(0, 100),
  ].join('::');

  return createHash('sha256').update(content).digest('hex');
}
