import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllowedModulesForLanguages } from '../lib/modules/language-filter';

const tsLanguages = { primary: 'typescript' as const, all: ['typescript'] as const };

test('library archetypes keep library checks and drop api-health', () => {
  const allowed = getAllowedModulesForLanguages(tsLanguages, 'library', {
    hasApiRoutes: false,
    hasFrontendBundle: false,
    hasPackageLibraryShape: true,
    hasTestSuite: true,
    hasLongRunningServer: false,
    hasDeployableService: false,
    hasCliEntrypoint: false,
    hasComplianceSignals: false,
    hasAgentToolingSignals: false,
  });

  assert.equal(allowed.has('dead-code'), true, 'library archetype should keep dead-code');
  assert.equal(allowed.has('api-health'), false, 'library archetype should drop api-health');
  assert.equal(
    allowed.has('telemetry-observability'),
    false,
    'library archetype should drop telemetry-observability',
  );
});

test('prototype archetypes suppress dead-code and service-specific modules', () => {
  const allowed = getAllowedModulesForLanguages(tsLanguages, 'prototype', {
    hasApiRoutes: false,
    hasFrontendBundle: false,
    hasPackageLibraryShape: false,
    hasTestSuite: false,
    hasLongRunningServer: false,
    hasDeployableService: false,
    hasCliEntrypoint: false,
    hasComplianceSignals: false,
    hasAgentToolingSignals: false,
  });

  assert.equal(allowed.has('dead-code'), false, 'prototype should drop dead-code');
  assert.equal(allowed.has('api-health'), false, 'prototype should drop api-health');
  assert.equal(allowed.has('build'), false, 'prototype should not allow build');
});

test('web-app archetypes allow execution checks when service and frontend traits are present', () => {
  const allowed = getAllowedModulesForLanguages(tsLanguages, 'web-app', {
    hasApiRoutes: true,
    hasFrontendBundle: true,
    hasPackageLibraryShape: false,
    hasTestSuite: true,
    hasLongRunningServer: false,
    hasDeployableService: true,
    hasCliEntrypoint: false,
    hasComplianceSignals: false,
    hasAgentToolingSignals: false,
  });

  assert.equal(allowed.has('api-health'), true, 'web-app should allow api-health');
  assert.equal(allowed.has('test-coverage'), true, 'web-app should allow test-coverage');
  assert.equal(allowed.has('test-quality'), true, 'web-app should allow test-quality');
});
