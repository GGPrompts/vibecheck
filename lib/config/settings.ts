import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const VIBECHECK_DIR = join(homedir(), '.vibecheck');
const CONFIG_PATH = join(VIBECHECK_DIR, 'config.json');

export interface Settings {
  scanDirs?: string[];
  auditPrompts?: Record<string, string>;
}

/**
 * Read settings from ~/.vibecheck/config.json.
 * Returns an empty Settings object if the file does not exist or is invalid.
 */
export function readSettings(): Settings {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Settings = {};
    if (Array.isArray(parsed.scanDirs)) {
      result.scanDirs = parsed.scanDirs.filter(
        (d: unknown) => typeof d === 'string' && d.length > 0,
      );
    }
    if (
      typeof parsed.auditPrompts === 'object' &&
      parsed.auditPrompts !== null &&
      !Array.isArray(parsed.auditPrompts)
    ) {
      const prompts: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.auditPrompts)) {
        if (typeof value === 'string' && value.length > 0) {
          prompts[key] = value;
        }
      }
      if (Object.keys(prompts).length > 0) {
        result.auditPrompts = prompts;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Write settings to ~/.vibecheck/config.json.
 * Creates the ~/.vibecheck directory if it does not exist.
 */
export function writeSettings(settings: Settings): void {
  mkdirSync(VIBECHECK_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
