import { nanoid } from 'nanoid';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { audits, auditResults } from '@/lib/db/schema';
import { createApiProvider } from '@/lib/ai/providers/api';
import { createCliProvider } from '@/lib/ai/providers/cli';
import { createCodexProvider } from '@/lib/ai/providers/codex';
import type { AIProvider } from '@/lib/ai/providers/types';
import { getAuditPrompt, getAvailableAuditModules } from './prompts';
import { auditEvents } from './event-emitter';
import { readSettings } from '@/lib/config/settings';
import { readVibecheckRc } from '@/lib/config/vibecheckrc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditOptions {
  provider: 'claude-api' | 'claude-cli' | 'codex';
  modules?: string[];
  signal?: AbortSignal;
}

export interface AuditFinding {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
}

interface ParsedAuditResponse {
  summary: string;
  findings: AuditFinding[];
}

// ---------------------------------------------------------------------------
// File collection (mirrors sampling.ts pattern but is self-contained)
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', 'out', '.git',
  'coverage', '.turbo', '.vercel', '__pycache__', '.cache',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        collectSourceFiles(fullPath, files);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// File sampling — select high-value files for audit review
// ---------------------------------------------------------------------------

/**
 * Select files for audit analysis.
 *
 * Uses a lightweight heuristic: prioritize files by size (larger files tend
 * to have more logic to review) and variety (spread across directories).
 * This does NOT use scan results to avoid anchoring bias.
 */
const MAX_AUDIT_FILES = 15;
const MAX_FILE_SIZE = 50_000; // 50KB per file to stay within token budget

function selectFilesForAudit(
  repoPath: string,
  maxFiles: number = MAX_AUDIT_FILES
): Array<{ path: string; content: string }> {
  const allFiles = collectSourceFiles(repoPath);
  if (allFiles.length === 0) return [];

  // Score files by size (proxy for logic density) — larger files get more review value
  const scored: Array<{ fullPath: string; relPath: string; size: number }> = [];
  for (const fullPath of allFiles) {
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const relPath = relative(repoPath, fullPath);
      scored.push({ fullPath, relPath, size: content.length });
    } catch {
      continue;
    }
  }

  // Sort by size descending, then take top N
  scored.sort((a, b) => b.size - a.size);

  // Ensure directory diversity: don't take more than 3 files from the same directory
  const dirCounts = new Map<string, number>();
  const selected: Array<{ path: string; content: string }> = [];

  for (const file of scored) {
    if (selected.length >= maxFiles) break;

    const dir = file.relPath.split('/').slice(0, -1).join('/') || '.';
    const count = dirCounts.get(dir) ?? 0;
    if (count >= 3) continue;

    try {
      let content = readFileSync(file.fullPath, 'utf-8');
      if (content.length > MAX_FILE_SIZE) {
        content = content.slice(0, MAX_FILE_SIZE) + '\n... (truncated)';
      }
      selected.push({ path: file.relPath, content });
      dirCounts.set(dir, count + 1);
    } catch {
      continue;
    }
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

function createProvider(providerName: 'claude-api' | 'claude-cli' | 'codex'): AIProvider {
  switch (providerName) {
    case 'claude-api':
      return createApiProvider();
    case 'claude-cli':
      return createCliProvider();
    case 'codex':
      return createCodexProvider();
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the AI response into structured findings.
 * Handles JSON wrapped in markdown code fences, raw JSON, or malformed responses.
 */
function parseAuditResponse(text: string): ParsedAuditResponse {
  // Strip markdown code fences if present
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const findings: AuditFinding[] = [];

    if (Array.isArray(parsed.findings)) {
      for (const f of parsed.findings) {
        if (typeof f === 'object' && f !== null && typeof f.message === 'string') {
          findings.push({
            severity: typeof f.severity === 'string' ? f.severity : 'medium',
            file: typeof f.file === 'string' ? f.file : '',
            line: typeof f.line === 'number' ? f.line : undefined,
            message: f.message,
            category: typeof f.category === 'string' ? f.category : 'general',
          });
        }
      }
    }

    return { summary, findings };
  } catch {
    // If parsing fails, return the raw text as summary with no structured findings
    return {
      summary: text.slice(0, 500),
      findings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Main audit runner
// ---------------------------------------------------------------------------

/**
 * Run an AI audit on a repository.
 *
 * Creates an audit record, iterates through the requested modules, sends
 * code to the AI provider for independent review, parses findings, and
 * stores results. Returns the audit ID.
 *
 * Critical design decision: the AI sees raw source code only, never scan
 * scores or previous findings. This prevents anchoring bias.
 */
export async function runAudit(
  repoPath: string,
  repoId: string,
  opts: AuditOptions
): Promise<string> {
  const auditId = nanoid();
  const startTime = Date.now();

  const provider = createProvider(opts.provider);

  // Determine which modules to audit
  const availableModules = getAvailableAuditModules();
  const requestedModules = opts.modules && opts.modules.length > 0
    ? opts.modules.filter((m) => availableModules.includes(m))
    : availableModules;

  // Create the audit record
  db.insert(audits).values({
    id: auditId,
    repoId,
    provider: opts.provider,
    model: undefined,
    status: 'running',
  }).run();

  // Check provider availability
  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    db.update(audits)
      .set({ status: 'failed', durationMs: Date.now() - startTime })
      .where(eq(audits.id, auditId))
      .run();
    throw new Error(`AI provider '${opts.provider}' is not available`);
  }

  // Select high-value files for review (from CODE, not from scan results)
  const files = selectFilesForAudit(repoPath);
  if (files.length === 0) {
    db.update(audits)
      .set({ status: 'failed', durationMs: Date.now() - startTime })
      .where(eq(audits.id, auditId))
      .run();
    throw new Error('No source files found in repository');
  }

  // Load custom prompts: settings (global) override, then .vibecheckrc (repo-level) override
  // Repo-level (.vibecheckrc) takes precedence over global settings.
  let customPrompts: Record<string, string> = {};
  try {
    const settings = readSettings();
    if (settings.auditPrompts) {
      customPrompts = { ...settings.auditPrompts };
    }
  } catch {
    // Settings unavailable — use defaults
  }
  try {
    const rc = readVibecheckRc(repoPath);
    if (rc?.auditPrompts) {
      customPrompts = { ...customPrompts, ...rc.auditPrompts };
    }
  } catch {
    // RC unavailable — use defaults
  }

  let moduleErrors = 0;

  for (const moduleId of requestedModules) {
    // Check for abort
    if (opts.signal?.aborted) {
      db.update(audits)
        .set({ status: 'failed', durationMs: Date.now() - startTime })
        .where(eq(audits.id, auditId))
        .run();
      throw new Error('Audit was aborted');
    }

    const promptTemplate = getAuditPrompt(moduleId);
    if (!promptTemplate) {
      moduleErrors++;
      continue;
    }

    auditEvents.emitProgress({
      auditId,
      moduleId,
      status: 'running',
      progress: 0,
      message: `Starting ${promptTemplate.name}...`,
    });

    const moduleStart = Date.now();

    try {
      // Build the prompt from raw source code — no scan scores
      const userPrompt = promptTemplate.buildUserPrompt(files);

      // Use custom system prompt if available, otherwise fall back to default
      const systemPrompt = customPrompts[moduleId] ?? promptTemplate.systemPrompt;

      // Send to AI provider
      const response = await provider.query(userPrompt, {
        system: systemPrompt,
        maxTokens: 4096,
      });

      // Parse the response
      const parsed = parseAuditResponse(response.text);

      // Store the result
      const tokensUsed = (response.inputTokens ?? 0) + (response.outputTokens ?? 0);
      const moduleDuration = Date.now() - moduleStart;

      db.insert(auditResults).values({
        auditId,
        moduleId,
        summary: parsed.summary,
        findings: JSON.stringify(parsed.findings),
        tokensUsed: tokensUsed || null,
        durationMs: moduleDuration,
      }).run();

      auditEvents.emitProgress({
        auditId,
        moduleId,
        status: 'complete',
        progress: 100,
        message: `${promptTemplate.name} complete — ${parsed.findings.length} finding(s)`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      moduleErrors++;

      // Store a failed result so we have a record of the attempt
      db.insert(auditResults).values({
        auditId,
        moduleId,
        summary: `Audit failed: ${errorMessage}`,
        findings: JSON.stringify([]),
        tokensUsed: null,
        durationMs: Date.now() - moduleStart,
      }).run();

      auditEvents.emitProgress({
        auditId,
        moduleId,
        status: 'error',
        progress: 0,
        message: `${promptTemplate.name} failed: ${errorMessage}`,
      });
    }
  }

  // Finalize the audit record
  const durationMs = Date.now() - startTime;
  const finalStatus = moduleErrors === requestedModules.length ? 'failed' : 'completed';

  db.update(audits)
    .set({ status: finalStatus, durationMs })
    .where(eq(audits.id, auditId))
    .run();

  return auditId;
}
