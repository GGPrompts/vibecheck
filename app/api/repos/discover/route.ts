import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { repos } from '@/lib/db/schema';
import { discoverRepos, getDefaultScanDirs } from '@/lib/discovery/scanner';
import { readSettings } from '@/lib/config/settings';

/**
 * GET /api/repos/discover — Scan configured directories and return discovered repos.
 *
 * Response: { repos: DiscoveredRepo[], alreadyRegistered: string[] }
 */
export async function GET() {
  try {
    // Determine scan directories: user config takes precedence, else defaults
    const settings = readSettings();
    const scanDirs =
      settings.scanDirs && settings.scanDirs.length > 0
        ? settings.scanDirs
        : getDefaultScanDirs();

    // Discover repos on disk
    const discovered = discoverRepos(scanDirs);

    // Fetch all registered repo paths from the database
    const registeredRepos = db.select({ path: repos.path }).from(repos).all();
    const registeredPaths = new Set(registeredRepos.map((r) => r.path));

    // Partition into new vs already registered
    const alreadyRegistered: string[] = [];
    const newRepos = discovered.filter((repo) => {
      if (registeredPaths.has(repo.path)) {
        alreadyRegistered.push(repo.path);
        return false;
      }
      return true;
    });

    return NextResponse.json({
      repos: newRepos,
      alreadyRegistered,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
