import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const dir = join(homedir(), '.vibecheck');
mkdirSync(dir, { recursive: true });

const sqlite = new Database(join(dir, 'vibecheck.db'));
sqlite.pragma('journal_mode = WAL');

// ── Auto-migration ──────────────────────────────────────────────────
// Tracks applied migrations in a `_migrations` table and runs pending
// .sql files from lib/db/migrations/ on every startup.

sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now')) NOT NULL
)`);

const migrationsDir = join(__dirname, 'migrations');
try {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    sqlite
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row) => (row as { name: string }).name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    sqlite.transaction(() => {
      for (const stmt of statements) {
        try {
          sqlite.exec(stmt);
        } catch (err) {
          // Ignore "duplicate column" or "table already exists" errors
          // from migrations that were partially applied manually
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('duplicate column') || msg.includes('already exists')) {
            continue;
          }
          throw err;
        }
      }
      sqlite.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    })();
  }
} catch {
  // Migrations dir may not exist in some environments
}

export const db = drizzle(sqlite);
