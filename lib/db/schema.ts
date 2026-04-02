import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export const repos = sqliteTable('repos', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  path: text('path').unique().notNull(),
  name: text('name').notNull(),
  overallScore: integer('overall_score'),
  lastScanAt: text('last_scan_at'),
  /** JSON metadata field. Stores optional fields like { mode: 'maintaining' | 'evaluating' } */
  metadata: text('metadata'),
  /** If this repo is a workspace inside a monorepo, references the parent repo id */
  parentRepoId: text('parent_repo_id'),
  /** Whether this repo is active (1) or inactive (0). Only active repos are scanned by "Scan All". */
  active: integer('active').notNull().default(1),
});

export const scans = sqliteTable('scans', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  repoId: text('repo_id').references(() => repos.id),
  status: text('status').notNull().default('pending'),
  overallScore: integer('overall_score'),
  configSnapshot: text('config_snapshot'),
  tokenUsage: integer('token_usage').default(0),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const moduleResults = sqliteTable('module_results', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  scanId: text('scan_id').references(() => scans.id),
  moduleId: text('module_id').notNull(),
  score: integer('score').notNull(),
  confidence: real('confidence').notNull(),
  state: text('state').notNull().default('completed'),
  stateReason: text('state_reason'),
  summary: text('summary'),
  metrics: text('metrics'),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  moduleResultId: text('module_result_id').references(() => moduleResults.id),
  fingerprint: text('fingerprint').notNull(),
  severity: text('severity').notNull(),
  filePath: text('file_path'),
  line: integer('line'),
  message: text('message').notNull(),
  category: text('category').notNull(),
  suggestion: text('suggestion'),
  status: text('status').notNull().default('new'),
});

export const scanConfigs = sqliteTable('scan_configs', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  repoId: text('repo_id').references(() => repos.id),
  enabledModules: text('enabled_modules'),
  aiTokenBudget: integer('ai_token_budget').default(100000),
});

export const audits = sqliteTable('audits', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  repoId: text('repo_id').references(() => repos.id),
  provider: text('provider').notNull(),
  model: text('model'),
  status: text('status').notNull().default('running'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  durationMs: integer('duration_ms'),
});

export const auditResults = sqliteTable('audit_results', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  auditId: text('audit_id').references(() => audits.id),
  moduleId: text('module_id').notNull(),
  summary: text('summary').notNull(),
  findings: text('findings').notNull(),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
});

export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  scanId: text('scan_id').references(() => scans.id),
  generatedPrompt: text('generated_prompt').notNull(),
  findingIds: text('finding_ids'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
