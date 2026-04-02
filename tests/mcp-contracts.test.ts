import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildComparePayload,
  buildHealthSuccessPayload,
  modulePayload,
} from '../mcp-server/tools/health-contracts';

const baseModule = {
  id: 'mr_base',
  moduleId: 'security',
  score: 85,
  confidence: 0.9,
  state: 'completed',
  stateReason: null,
  summary: 'base',
  metrics: { warnings: 1 },
  findings: [
    {
      id: 'f1',
      fingerprint: 'base-fp',
      severity: 'high',
      filePath: 'src/index.ts',
      line: 10,
      message: 'base finding',
      category: 'security',
      suggestion: 'fix it',
      status: 'new',
    },
  ],
};

const headModule = {
  ...baseModule,
  id: 'mr_head',
  score: 60,
  summary: 'head',
  findings: [
    {
      id: 'f1',
      fingerprint: 'base-fp',
      severity: 'high',
      filePath: 'src/index.ts',
      line: 10,
      message: 'base finding',
      category: 'security',
      suggestion: 'fix it',
      status: 'new',
    },
    {
      id: 'f2',
      fingerprint: 'new-fp',
      severity: 'medium',
      filePath: 'src/new.ts',
      line: 4,
      message: 'new finding',
      category: 'quality',
      suggestion: null,
      status: 'new',
    },
  ],
};

test('modulePayload exposes the richer module contract shape', () => {
  const payload = modulePayload(headModule);

  assert.deepEqual(payload, {
    module_result_id: 'mr_head',
    module_id: 'security',
    score: 60,
    confidence: 0.9,
    state: 'completed',
    state_reason: null,
    applicable: true,
    summary: 'head',
    metrics: { warnings: 1 },
    findings_count: 2,
    suggestion_count: 1,
    findings: headModule.findings,
  });
});

test('buildHealthSuccessPayload keeps the MCP health response shape stable', () => {
  const payload = buildHealthSuccessPayload(
    { name: 'repo', path: '/repo' },
    { id: 'scan-1', createdAt: '2026-04-01T00:00:00.000Z', overallScore: 77 },
    [headModule],
  );

  assert.equal(payload.status, 'ok');
  assert.equal(payload.repo, 'repo');
  assert.equal(payload.scan_id, 'scan-1');
  assert.equal(payload.modules[0].module_result_id, 'mr_head');
  assert.equal(payload.modules[0].findings_count, 2);
});

test('buildComparePayload reports regressions, improvements, and new findings', () => {
  const payload = buildComparePayload(
    { name: 'repo', path: '/repo' },
    {
      scan: { id: 'scan-base', overallScore: 90 },
      modules: [baseModule],
    },
    {
      scan: { id: 'scan-head', overallScore: 72 },
      modules: [
        {
          ...headModule,
          state: 'completed',
        },
      ],
    },
    10,
  );

  assert.equal(payload.base_scan_id, 'scan-base');
  assert.equal(payload.head_scan_id, 'scan-head');
  assert.equal(payload.overall_delta, -18);
  assert.equal(payload.regressions.length, 1);
  assert.equal(payload.regressions[0].module_id, 'security');
  assert.equal(payload.new_findings.length, 1);
  assert.equal(payload.new_findings[0].module_id, 'security');
});
