import assert from 'node:assert/strict';
import test from 'node:test';
import { autoDetect } from '../lib/config/auto-detect';
import { createRepoFixture } from './helpers';

test('auto-detect infers web-app and service traits from app/api plus next dependency', () => {
  const repoPath = createRepoFixture({
    'package.json': JSON.stringify({
      name: 'web-app',
      dependencies: { next: '^16.2.1' },
    }),
    'app/page.tsx': 'export default function Page() { return null; }',
    'app/api/health/route.ts': 'export function GET() { return Response.json({ ok: true }); }',
  });

  const result = autoDetect(repoPath);

  assert.equal(result.detectedFramework, 'nextjs');
  assert.equal(result.detectedArchetype, 'web-app');
  assert.equal(result.configOverlay.profile, 'web-app');
  assert.equal(result.repoTraits.hasApiRoutes, true);
  assert.equal(result.repoTraits.hasFrontendBundle, true);
});

test('auto-detect infers cli for Cargo workspace with binary targets', () => {
  const cargoRepo = createRepoFixture({
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n\n[[bin]]\nname = "therminal"\npath = "crates/therminal-app/src/main.rs"',
    'crates/therminal-app/src/main.rs': 'fn main() {}',
    'scripts/ci.sh': '#!/bin/bash',
    'audits/something.txt': '',
  });

  const result = autoDetect(cargoRepo);

  assert.equal(result.detectedArchetype, 'cli');
  assert.equal(result.repoTraits.hasCliEntrypoint, true);
  // audits/ alone should NOT trigger compliance
  assert.equal(result.repoTraits.hasComplianceSignals, false);
});

test('auto-detect infers cli for Go module with main.go', () => {
  const goRepo = createRepoFixture({
    'go.mod': 'module example.com/tool\n\ngo 1.22',
    'main.go': 'package main\nfunc main() {}',
  });

  const result = autoDetect(goRepo);

  assert.equal(result.detectedArchetype, 'cli');
  assert.equal(result.repoTraits.hasCliEntrypoint, true);
});

test('auto-detect does not treat app/ as frontend in a Rust project', () => {
  const rustRepo = createRepoFixture({
    'Cargo.toml': '[package]\nname = "my-app"',
    'src/main.rs': 'fn main() {}',
    'app/something.rs': '',
  });

  const result = autoDetect(rustRepo);

  assert.equal(result.repoTraits.hasFrontendBundle, false);
  assert.equal(result.detectedArchetype, 'cli');
});

test('auto-detect infers library, cli, and agent-tooling shapes from repo layout', () => {
  const libraryRepo = createRepoFixture({
    'package.json': JSON.stringify({
      name: 'library',
      exports: './dist/index.js',
    }),
    'src/index.ts': 'export const value = 1;',
  });

  const cliRepo = createRepoFixture({
    'package.json': JSON.stringify({
      name: 'cli',
      bin: { vibecheck: './bin/vibecheck.mjs' },
    }),
    'bin/vibecheck.mjs': '#!/usr/bin/env node',
  });

  const agentRepo = createRepoFixture({
    'package.json': JSON.stringify({ name: 'agent-tooling' }),
    'mcp-server/index.ts': 'export {};',
    'prompts/root.md': '# prompt',
  });

  const library = autoDetect(libraryRepo);
  const cli = autoDetect(cliRepo);
  const agent = autoDetect(agentRepo);

  assert.equal(library.detectedArchetype, 'library');
  assert.equal(library.repoTraits.hasPackageLibraryShape, true);
  assert.equal(cli.detectedArchetype, 'cli');
  assert.equal(cli.repoTraits.hasCliEntrypoint, true);
  assert.equal(agent.detectedArchetype, 'agent-tooling');
  assert.equal(agent.repoTraits.hasAgentToolingSignals, true);
});
