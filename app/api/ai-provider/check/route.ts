import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * GET /api/ai-provider/check
 *
 * Check availability of the CLI provider (whether `claude` binary is on PATH).
 */
export async function GET() {
  let cliAvailable = false;

  try {
    await execFileAsync('command', ['-v', 'claude'], {
      shell: true,
      timeout: 5_000,
    });
    cliAvailable = true;
  } catch {
    cliAvailable = false;
  }

  return NextResponse.json({ cliAvailable });
}
