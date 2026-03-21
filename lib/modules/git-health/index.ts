import { existsSync } from 'fs';
import { join } from 'path';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';
import { analyzeBusFactor } from './bus-factor';
import { analyzeChurn } from './churn';
import { analyzeTodoAge } from './todo-age';
import { analyzeStaleAreas } from './stale-areas';
import { analyzeExternalSilos } from './external-silos';

// ---------------------------------------------------------------------------
// Weights: churn 40%, external-silo 20%, todo-age 20%, stale-areas 20%
// Bus factor is info-only (no score impact) — solo devs and AI-assisted
// workflows should not be penalized for single-author files.
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, '.git'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    const allFindings: Finding[] = [];
    const metrics: Record<string, number> = {};

    // 1. Bus factor — info-only (0% weight), no score impact
    opts.onProgress?.(5, 'Analyzing bus factor (info-only)...');
    try {
      const busFactor = await analyzeBusFactor(repoPath);
      // Downgrade all bus-factor findings to info — they are informational
      // signals, not score penalties
      for (const finding of busFactor.findings) {
        finding.severity = 'info';
      }
      allFindings.push(...busFactor.findings);
      metrics.busFactor = Math.round(busFactor.authorDiversity * 100);
      metrics.knowledgeSiloFiles = busFactor.findings.length;
    } catch {
      metrics.busFactor = -1;
    }

    // 2. Churn (40%)
    opts.onProgress?.(20, 'Analyzing churn hotspots...');
    let churnHealth = 1.0;
    try {
      const churn = await analyzeChurn(repoPath);
      allFindings.push(...churn.findings);
      churnHealth = churn.churnHealth;
      metrics.churnHealth = Math.round(churnHealth * 100);
      metrics.highChurnFiles = churn.findings.length;
    } catch {
      metrics.churnHealth = -1;
    }

    // 3. External knowledge silos (20%)
    opts.onProgress?.(40, 'Scanning for external knowledge silos...');
    let siloScore = 1.0;
    try {
      const silos = analyzeExternalSilos(repoPath);
      allFindings.push(...silos.findings);
      siloScore = silos.siloScore;
      metrics.externalSiloScore = Math.round(siloScore * 100);
      metrics.externalSiloRefs = silos.findings.length;
    } catch {
      metrics.externalSiloScore = -1;
    }

    // 4. TODO age (20%)
    opts.onProgress?.(60, 'Analyzing TODO/FIXME age...');
    let todoScore = 1.0;
    try {
      const todos = analyzeTodoAge(repoPath);
      allFindings.push(...todos.findings);
      todoScore = todos.todoScore;
      metrics.todoScore = Math.round(todoScore * 100);
      metrics.staleTodos = todos.findings.length;
    } catch {
      metrics.todoScore = -1;
    }

    // 5. Stale areas (20%)
    opts.onProgress?.(80, 'Analyzing stale areas...');
    let freshnessScore = 1.0;
    try {
      const stale = analyzeStaleAreas(repoPath);
      allFindings.push(...stale.findings);
      freshnessScore = stale.freshnessScore;
      metrics.freshness = Math.round(freshnessScore * 100);
      metrics.staleDirectories = stale.findings.length;
    } catch {
      metrics.freshness = -1;
    }

    // Composite score: churn 40%, external-silo 20%, todo 20%, stale 20%
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          churnHealth * 40 +
            siloScore * 20 +
            todoScore * 20 +
            freshnessScore * 20
        )
      )
    );

    metrics.totalFindings = allFindings.length;

    opts.onProgress?.(100, 'Git health analysis complete.');

    const summaryParts: string[] = [];
    summaryParts.push(`Git health score: ${score}/100.`);
    if (metrics.knowledgeSiloFiles > 0) {
      summaryParts.push(
        `${metrics.knowledgeSiloFiles} knowledge silo files (info-only).`
      );
    }
    if (metrics.highChurnFiles > 0) {
      summaryParts.push(`${metrics.highChurnFiles} high-churn hotspots.`);
    }
    if (metrics.externalSiloRefs > 0) {
      summaryParts.push(
        `${metrics.externalSiloRefs} external knowledge silo references.`
      );
    }
    if (metrics.staleTodos > 0) {
      summaryParts.push(`${metrics.staleTodos} stale TODOs (>90 days).`);
    }
    if (metrics.staleDirectories > 0) {
      summaryParts.push(
        `${metrics.staleDirectories} stale directories (>6 months).`
      );
    }

    return {
      score,
      confidence: 0.9,
      findings: allFindings,
      metrics,
      summary: summaryParts.join(' '),
    };
  },
};

registerModule(
  {
    id: 'git-health',
    name: 'Git Health',
    description:
      'Git history analysis: churn, external silos, TODOs, staleness',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
