import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { audits, auditResults } from '@/lib/db/schema';

/**
 * A single parsed finding from an audit module result.
 */
interface AuditFinding {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
}

/**
 * Normalise a file path for comparison: lowercase, trim whitespace, strip
 * leading "./" and trailing slashes.
 */
function normalisePath(p: string): string {
  return p.trim().toLowerCase().replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Normalise a category string for comparison.
 */
function normaliseCategory(c: string): string {
  return c.trim().toLowerCase().replace(/[\s_-]+/g, '-');
}

/**
 * Build a "match key" for a finding so we can detect agreements across
 * providers. Two findings match when they reference the same file path and
 * belong to the same (normalised) category.
 */
function findingMatchKey(f: AuditFinding): string {
  const file = f.file ? normalisePath(f.file) : '__no_file__';
  const cat = normaliseCategory(f.category);
  return `${file}::${cat}`;
}

/**
 * GET /api/repos/[id]/compare-audits
 *
 * Loads all completed audits for a repository, groups them by provider, and
 * computes per-module and overall agreement metrics between providers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: repoId } = await params;

    // Fetch all completed audits for this repo
    const repoAudits = db
      .select()
      .from(audits)
      .where(and(eq(audits.repoId, repoId), eq(audits.status, 'completed')))
      .all();

    // Group by provider, keeping only the latest audit per provider
    const latestByProvider = new Map<string, typeof repoAudits[number]>();
    for (const audit of repoAudits) {
      const existing = latestByProvider.get(audit.provider);
      if (!existing || audit.createdAt > existing.createdAt) {
        latestByProvider.set(audit.provider, audit);
      }
    }

    const providerKeys = Array.from(latestByProvider.keys()).sort();

    if (providerKeys.length < 2) {
      return NextResponse.json({
        insufficientProviders: true,
        availableProviders: providerKeys,
        message:
          providerKeys.length === 0
            ? 'No completed audits found for this repository. Run an audit to get started.'
            : `Only one provider (${providerKeys[0]}) has completed audits. Run an audit with a different provider to enable comparison.`,
      });
    }

    // Load full module results for each provider's latest audit
    type ProviderData = {
      provider: string;
      auditId: string;
      model: string | null;
      createdAt: string;
      modules: {
        moduleId: string;
        summary: string;
        findings: AuditFinding[];
      }[];
    };

    const providerData: ProviderData[] = [];

    for (const provider of providerKeys) {
      const audit = latestByProvider.get(provider)!;
      const results = db
        .select()
        .from(auditResults)
        .where(eq(auditResults.auditId, audit.id))
        .all();

      const modules = results.map((r) => {
        let parsedFindings: AuditFinding[] = [];
        try {
          const parsed = JSON.parse(r.findings);
          if (Array.isArray(parsed)) {
            parsedFindings = parsed;
          }
        } catch {
          // keep empty
        }
        return {
          moduleId: r.moduleId,
          summary: r.summary,
          findings: parsedFindings,
        };
      });

      providerData.push({
        provider,
        auditId: audit.id,
        model: audit.model,
        createdAt: audit.createdAt,
        modules,
      });
    }

    // For the comparison view we compare pairs. If more than 2 providers
    // exist we still return all data and compare the first two by default,
    // but the client can pick any pair.
    const providerA = providerData[0];
    const providerB = providerData[1];

    // Collect all module IDs across both providers
    const allModuleIds = new Set<string>();
    for (const m of providerA.modules) allModuleIds.add(m.moduleId);
    for (const m of providerB.modules) allModuleIds.add(m.moduleId);

    let totalAgreed = 0;
    let totalUnion = 0;

    const moduleComparisons = Array.from(allModuleIds)
      .sort()
      .map((moduleId) => {
        const modA = providerA.modules.find((m) => m.moduleId === moduleId);
        const modB = providerB.modules.find((m) => m.moduleId === moduleId);

        const findingsA = modA?.findings ?? [];
        const findingsB = modB?.findings ?? [];

        // Build match-key sets
        const keysA = new Set(findingsA.map(findingMatchKey));
        const keysB = new Set(findingsB.map(findingMatchKey));

        // Agreements: keys in both
        const agreedKeys = new Set<string>();
        for (const k of keysA) {
          if (keysB.has(k)) agreedKeys.add(k);
        }

        // Provider A only
        const onlyAKeys = new Set<string>();
        for (const k of keysA) {
          if (!keysB.has(k)) onlyAKeys.add(k);
        }

        // Provider B only
        const onlyBKeys = new Set<string>();
        for (const k of keysB) {
          if (!keysA.has(k)) onlyBKeys.add(k);
        }

        const unionSize = new Set([...keysA, ...keysB]).size;
        const agreementScore =
          unionSize > 0
            ? Math.round((agreedKeys.size / unionSize) * 100)
            : 100; // If neither found anything, they "agree"

        totalAgreed += agreedKeys.size;
        totalUnion += unionSize;

        // Map keys back to finding details for the response
        const keyToFindingsA = new Map<string, AuditFinding[]>();
        for (const f of findingsA) {
          const k = findingMatchKey(f);
          if (!keyToFindingsA.has(k)) keyToFindingsA.set(k, []);
          keyToFindingsA.get(k)!.push(f);
        }
        const keyToFindingsB = new Map<string, AuditFinding[]>();
        for (const f of findingsB) {
          const k = findingMatchKey(f);
          if (!keyToFindingsB.has(k)) keyToFindingsB.set(k, []);
          keyToFindingsB.get(k)!.push(f);
        }

        return {
          moduleId,
          summaryA: modA?.summary ?? null,
          summaryB: modB?.summary ?? null,
          agreementScore,
          agreements: Array.from(agreedKeys).map((k) => ({
            key: k,
            findingsA: keyToFindingsA.get(k) ?? [],
            findingsB: keyToFindingsB.get(k) ?? [],
          })),
          providerAOnly: Array.from(onlyAKeys).map((k) => ({
            key: k,
            findings: keyToFindingsA.get(k) ?? [],
          })),
          providerBOnly: Array.from(onlyBKeys).map((k) => ({
            key: k,
            findings: keyToFindingsB.get(k) ?? [],
          })),
          findingCountA: findingsA.length,
          findingCountB: findingsB.length,
        };
      });

    const overallAgreementScore =
      totalUnion > 0 ? Math.round((totalAgreed / totalUnion) * 100) : 100;

    return NextResponse.json({
      insufficientProviders: false,
      providerA: {
        provider: providerA.provider,
        auditId: providerA.auditId,
        model: providerA.model,
        createdAt: providerA.createdAt,
      },
      providerB: {
        provider: providerB.provider,
        auditId: providerB.auditId,
        model: providerB.model,
        createdAt: providerB.createdAt,
      },
      allProviders: providerData.map((p) => ({
        provider: p.provider,
        auditId: p.auditId,
        model: p.model,
        createdAt: p.createdAt,
      })),
      overallAgreementScore,
      moduleComparisons,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
