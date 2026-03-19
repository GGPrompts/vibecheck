import type { Config } from 'drizzle-kit';
import { join } from 'path';
import { homedir } from 'os';

export default {
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(homedir(), '.vibecheck', 'vibecheck.db'),
  },
} satisfies Config;
