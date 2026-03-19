import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const dir = join(homedir(), '.vibecheck');
mkdirSync(dir, { recursive: true });

const sqlite = new Database(join(dir, 'vibecheck.db'));
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite);
