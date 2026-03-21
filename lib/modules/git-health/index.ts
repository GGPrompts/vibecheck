import { existsSync } from 'fs';
import { join } from 'path';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';
import { analyzeBusFactor } from './bus-factor';
import { analyzeChurn } from './churn';
import { analyzeTodoAge } from './todo-age';
import { analyzeStaleAreas } from './stale-areas';

// ---------------------------------------------------------------------------
// Module runner
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, '.git'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    const allFindings: Finding[] = [];
    const metrics: Record<string, number> = {};

    // Roles where bus-factor findings should be downgraded to info
    const busFactorDowngradeRoles = new Set(['cli-entrypoint', 'mcp-tool', 'provider']);

    // 1. Bus factor (30%)
    opts.onProgress?.(5, 'Analyzing bus factor...');
    let authorDiversity = 1.0;
    try {
      const busFactor = await analyzeBusFactor(repoPath);
      // Downgrade bus-factor severity for infrastructure files
      for (const finding of busFactor.findings) {
        const roles = opts.fileRoles?.get(finding.filePath);
        if (roles?.some((r) => busFactorDowngradeRoles.has(r))) {
          finding.severity = 'info';
        }
      }
      allFindings.push(...busFactor.findings);
      authorDiversity = busFactor.authorDiversity;
      metrics.busFactor = Math.round(authorDiversity * 100);
      metrics.knowledgeSiloFiles = busFactor.findings.length;
    } catch {
      metrics.busFactor = -1;
    }

    // 2. Churn (30%)
    opts.onProgress?.(30, 'Analyzing churn hotspots...');
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

    // 3. TODO age (20%)
    opts.onProgress?.(55, 'Analyzing TODO/FIXME age...');
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

    // 4. Stale areas (20%)
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

    // Composite score: weighted combination
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          authorDiversity * 30 +
            churnHealth * 30 +
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
        `${metrics.knowledgeSiloFiles} knowledge silo files detected.`
      );
    }
    if (metrics.highChurnFiles > 0) {
      summaryParts.push(`${metrics.highChurnFiles} high-churn hotspots.`);
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
      'Git history analysis: bus factor, churn, TODOs, staleness',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
