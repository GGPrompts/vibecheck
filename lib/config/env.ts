/**
 * Shared helpers for reading/writing the vibecheck .env file
 * at ~/.vibecheck/.env.
 *
 * Used by both the settings API route and the MCP server.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const VIBECHECK_DIR = join(homedir(), '.vibecheck');
const ENV_PATH = join(VIBECHECK_DIR, '.env');

export function hasApiKey(): boolean {
  try {
    if (!existsSync(ENV_PATH)) return false;
    const content = readFileSync(ENV_PATH, 'utf-8');
    return content.split('\n').some((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('ANTHROPIC_API_KEY=') &&
        trimmed.length > 'ANTHROPIC_API_KEY='.length
      );
    });
  } catch {
    return false;
  }
}

export function readEnvValue(key: string): string | undefined {
  try {
    if (!existsSync(ENV_PATH)) return undefined;
    const content = readFileSync(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const k = trimmed.slice(0, eqIndex).trim();
      const v = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (k === key) return v;
    }
  } catch {
    // File doesn't exist or isn't readable
  }
  return undefined;
}

export function writeEnvValue(key: string, value: string): void {
  mkdirSync(VIBECHECK_DIR, { recursive: true });

  let content = '';
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, 'utf-8');
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (idx >= 0) {
      lines[idx] = `${key}=${value}`;
      content = lines.join('\n');
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
  } else {
    content = `${key}=${value}\n`;
  }

  writeFileSync(ENV_PATH, content, 'utf-8');
}

export function writeApiKey(key: string): void {
  writeEnvValue('ANTHROPIC_API_KEY', key);
}
