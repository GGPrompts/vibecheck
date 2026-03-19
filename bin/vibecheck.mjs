#!/usr/bin/env node

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve, basename, join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let repoPath = null;
let port = 3000;
let noOpen = false;
let showHelp = false;
let promptMode = false;
let jsonMode = false;
let modulesFilter = '';
let threshold = 50;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    showHelp = true;
  } else if (arg === '--no-open') {
    noOpen = true;
  } else if (arg === '--prompt') {
    promptMode = true;
  } else if (arg === '--json') {
    jsonMode = true;
  } else if (arg === '--modules') {
    const val = args[++i];
    if (!val) {
      console.error('Error: --modules requires a comma-separated list of module IDs');
      process.exit(1);
    }
    modulesFilter = val;
  } else if (arg.startsWith('--modules=')) {
    modulesFilter = arg.split('=').slice(1).join('=');
  } else if (arg === '--threshold') {
    const val = args[++i];
    if (!val || isNaN(Number(val))) {
      console.error('Error: --threshold requires a numeric value');
      process.exit(1);
    }
    threshold = Number(val);
  } else if (arg.startsWith('--threshold=')) {
    const val = arg.split('=')[1];
    if (!val || isNaN(Number(val))) {
      console.error('Error: --threshold requires a numeric value');
      process.exit(1);
    }
    threshold = Number(val);
  } else if (arg === '--port') {
    const val = args[++i];
    if (!val || isNaN(Number(val))) {
      console.error('Error: --port requires a numeric value');
      process.exit(1);
    }
    port = Number(val);
  } else if (arg.startsWith('--port=')) {
    const val = arg.split('=')[1];
    if (!val || isNaN(Number(val))) {
      console.error('Error: --port requires a numeric value');
      process.exit(1);
    }
    port = Number(val);
  } else if (arg.startsWith('-')) {
    console.error(`Unknown flag: ${arg}`);
    console.error('Run "vibecheck --help" for usage.');
    process.exit(1);
  } else {
    repoPath = arg;
  }
}

if (showHelp) {
  console.log(`
vibecheck — codebase health dashboard

Usage:
  vibecheck /path/to/repo [options]

Options:
  --port <number>       Port for the web server (default: 3000)
  --no-open             Don't open the browser automatically
  --prompt              Run headlessly and output the generated Claude prompt to stdout
  --json                Run headlessly and output structured scan results as JSON
  --modules <ids>       Run only specific modules (comma-separated)
  --threshold <number>  Score threshold for exit code (default: 50)
                        Exit 0 if score >= threshold, exit 1 if below
  -h, --help            Show this help message

Headless mode (--prompt or --json):
  Runs the scan directly without starting a web server. Useful for CI/CD
  pipelines and scripting. The prompt or JSON is written to stdout; progress
  messages go to stderr.

Examples:
  npx vibecheck .
  npx vibecheck /home/user/my-project --port 4000
  npx vibecheck ./my-repo --no-open
  npx vibecheck . --prompt
  npx vibecheck . --json --threshold 70
  npx vibecheck . --prompt --modules complexity,security
  npx vibecheck . --json --modules git-health,dependencies --threshold 60
`);
  process.exit(0);
}

if (promptMode && jsonMode) {
  console.error('Error: --prompt and --json are mutually exclusive. Use one or the other.');
  process.exit(1);
}

if (!repoPath) {
  console.error('Error: Please provide a path to a repository.');
  console.error('Usage: vibecheck /path/to/repo [--port 3000] [--no-open]');
  process.exit(1);
}

// Resolve to absolute path
repoPath = resolve(repoPath);

if (!existsSync(repoPath)) {
  console.error(`Error: Path does not exist: ${repoPath}`);
  process.exit(1);
}

// ── Database: register repo if not exists ────────────────────────────────────

// We use better-sqlite3 directly to avoid needing the full Next.js/drizzle
// setup. This mirrors the logic in lib/db/client.ts and app/api/repos/route.ts.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const dbDir = join(homedir(), '.vibecheck');
mkdirSync(dbDir, { recursive: true });

const dbPath = join(dbDir, 'vibecheck.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

// Ensure all tables exist (mirrors schema from lib/db/schema.ts)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    overall_score INTEGER,
    last_scan_at TEXT,
    metadata TEXT,
    parent_repo_id TEXT
  );
  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    repo_id TEXT REFERENCES repos(id),
    status TEXT NOT NULL DEFAULT 'pending',
    overall_score INTEGER,
    config_snapshot TEXT,
    token_usage INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS module_results (
    id TEXT PRIMARY KEY,
    scan_id TEXT REFERENCES scans(id),
    module_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    confidence REAL NOT NULL,
    summary TEXT,
    metrics TEXT
  );
  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    module_result_id TEXT REFERENCES module_results(id),
    fingerprint TEXT NOT NULL,
    severity TEXT NOT NULL,
    file_path TEXT,
    line INTEGER,
    message TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
  );
  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    scan_id TEXT REFERENCES scans(id),
    generated_prompt TEXT NOT NULL,
    finding_ids TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scan_configs (
    id TEXT PRIMARY KEY,
    repo_id TEXT REFERENCES repos(id),
    enabled_modules TEXT,
    ai_token_budget INTEGER DEFAULT 100000
  );
`);

// Check if repo already registered
let repo = sqlite.prepare('SELECT * FROM repos WHERE path = ?').get(repoPath);

if (!repo) {
  // Derive name from package.json if possible, otherwise use directory basename
  let name = basename(repoPath);
  try {
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        name = pkg.name;
      }
    }
  } catch {
    // Ignore — fall back to basename
  }

  // Generate a nanoid-style ID (21 chars, URL-safe alphabet)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => alphabet[b % 64]).join('');

  const metadata = JSON.stringify({ mode: 'maintaining' });
  sqlite.prepare('INSERT INTO repos (id, path, name, metadata) VALUES (?, ?, ?, ?)').run(id, repoPath, name, metadata);
  repo = sqlite.prepare('SELECT * FROM repos WHERE path = ?').get(repoPath);

  // Only print registration info to stderr in headless mode so stdout stays clean
  if (promptMode || jsonMode) {
    process.stderr.write(`Registered new repo: ${name} (${id})\n`);
  } else {
    console.log(`Registered new repo: ${name} (${id})`);
  }
} else {
  if (promptMode || jsonMode) {
    process.stderr.write(`Found existing repo: ${repo.name} (${repo.id})\n`);
  } else {
    console.log(`Found existing repo: ${repo.name} (${repo.id})`);
  }
}

const repoId = repo.id;
sqlite.close();

// ── Headless mode: --prompt or --json ────────────────────────────────────────

if (promptMode || jsonMode) {
  const tsxBin = join(projectRoot, 'node_modules', '.bin', 'tsx');
  const headlessScript = join(projectRoot, 'bin', 'headless-scan.ts');

  const mode = promptMode ? 'prompt' : 'json';

  const childEnv = {
    ...process.env,
    VIBECHECK_REPO_PATH: repoPath,
    VIBECHECK_REPO_ID: repoId,
    VIBECHECK_MODE: mode,
    VIBECHECK_THRESHOLD: String(threshold),
  };

  if (modulesFilter) {
    childEnv.VIBECHECK_MODULES = modulesFilter;
  }

  const child = spawn(tsxBin, [headlessScript], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });

  // Pipe stdout (prompt/JSON) to our stdout
  child.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  // Pipe stderr (progress messages) to our stderr
  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  child.on('error', (err) => {
    console.error(`Failed to start headless scan: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
} else {
  // ── Interactive mode: Start Next.js dev server ─────────────────────────────

  const url = `http://localhost:${port}/repo/${repoId}`;

  console.log(`Starting vibecheck server on port ${port}...`);

  const nextBin = join(projectRoot, 'node_modules', '.bin', 'next');
  const serverProcess = spawn(nextBin, ['dev', '--port', String(port)], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Forward server output but watch for the ready signal
  let serverReady = false;

  serverProcess.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);

    if (!serverReady && (text.includes('Ready') || text.includes('ready') || text.includes(`localhost:${port}`))) {
      serverReady = true;
      onServerReady();
    }
  });

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  serverProcess.on('error', (err) => {
    console.error(`Failed to start Next.js server: ${err.message}`);
    process.exit(1);
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Next.js server exited with code ${code}`);
      process.exit(code);
    }
  });

  // Graceful shutdown
  function cleanup() {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  }

  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // ── Once server is ready: trigger scan and open browser ──────────────────

  async function onServerReady() {
    console.log(`\nVibecheck is ready at ${url}\n`);

    // Trigger a scan via the API
    try {
      console.log('Triggering scan...');
      const response = await fetch(`http://localhost:${port}/api/scans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId }),
      });
      const result = await response.json();
      if (response.ok) {
        console.log(`Scan started (id: ${result.scanId})`);
      } else {
        console.error(`Failed to trigger scan: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(`Failed to trigger scan: ${err.message}`);
    }

    // Open browser unless --no-open
    if (!noOpen) {
      openBrowser(url);
    }
  }

  function openBrowser(targetUrl) {
    const platform = process.platform;
    let cmd;
    let cmdArgs;
    if (platform === 'darwin') {
      cmd = 'open';
      cmdArgs = [targetUrl];
    } else if (platform === 'win32') {
      cmd = 'cmd';
      cmdArgs = ['/c', 'start', targetUrl];
    } else {
      cmd = 'xdg-open';
      cmdArgs = [targetUrl];
    }

    const browser = spawn(cmd, cmdArgs, {
      stdio: 'ignore',
      detached: true,
    });
    browser.unref();
  }

  // Fallback: if the server doesn't signal ready within 30 seconds, proceed anyway
  setTimeout(() => {
    if (!serverReady) {
      serverReady = true;
      console.log('\nServer startup timed out waiting for ready signal. Proceeding...');
      onServerReady();
    }
  }, 30000);
}
