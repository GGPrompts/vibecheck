import { spawn, type ChildProcess } from 'child_process';

const DEFAULT_PORT = 3999;
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const PROBE_TIMEOUT_MS = 2_000;

interface DevServer {
  /** Port the server is listening on */
  port: number;
  /** Call to kill the spawned server process (no-op if we attached to an existing server) */
  cleanup: () => void;
}

/**
 * Probe a localhost URL to check if a server is responding.
 * Returns true if the server responds (any status), false on network error or timeout.
 */
async function isServerReady(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const response = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    // Any response means the server is up (even 404 is fine)
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a server to become ready by polling.
 * Rejects if the server doesn't respond within the timeout.
 */
function waitForReady(port: number, timeoutMs: number = READY_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = async () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Dev server did not become ready within ${timeoutMs / 1000}s on port ${port}`));
        return;
      }

      const ready = await isServerReady(port);
      if (ready) {
        resolve();
      } else {
        setTimeout(check, POLL_INTERVAL_MS);
      }
    };

    check();
  });
}

/**
 * Ensure a Next.js dev server is running and reachable.
 *
 * 1. If a server is already responding on the given port, reuse it
 *    (cleanup will be a no-op).
 * 2. Otherwise, spawn `next dev --port <port>` and wait for it to
 *    become ready, polling every 500ms.
 * 3. Returns a cleanup function that kills the spawned process.
 * 4. Times out after 30 seconds if the server never responds.
 *
 * @param port - Port to use (default: 3999 to avoid conflict with typical dev on 3000)
 * @returns Object with the port and a cleanup function
 */
export async function ensureDevServer(port: number = DEFAULT_PORT): Promise<DevServer> {
  // Check if a server is already running on this port
  const alreadyRunning = await isServerReady(port);
  if (alreadyRunning) {
    return {
      port,
      cleanup: () => {
        // No-op: we didn't start this server
      },
    };
  }

  // Spawn the Next.js dev server
  let child: ChildProcess;
  try {
    child = spawn('npx', ['next', 'dev', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  } catch (err) {
    throw new Error(
      `Failed to spawn dev server: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Collect stderr for diagnostics if the process exits early
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // If the process exits before the server is ready, reject
  const earlyExit = new Promise<never>((_, reject) => {
    child.on('error', (err) => {
      reject(new Error(`Dev server process error: ${err.message}`));
    });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        reject(
          new Error(
            `Dev server exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`
          )
        );
      }
    });
  });

  // Race: either the server becomes ready, or it crashes / times out
  try {
    await Promise.race([waitForReady(port), earlyExit]);
  } catch (err) {
    // Clean up the process on failure
    try {
      child.kill('SIGTERM');
    } catch {
      // Ignore kill errors
    }
    throw err;
  }

  const cleanup = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process may have already exited
    }
  };

  return { port, cleanup };
}
