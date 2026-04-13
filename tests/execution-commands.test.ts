import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericCommandOutput } from '../lib/modules/execution-checks/index';
import { readVibecheckRc } from '../lib/config/vibecheckrc';
import { createRepoFixture } from './helpers';

// ── parseGenericCommandOutput ──────────────────────────────────────────

test('parseGenericCommandOutput parses file:line:col: message format', () => {
  const stderr = 'src/main.rs:42:5: error: mismatched types';
  const findings = parseGenericCommandOutput('build', '', stderr, 1, 'build', 'Fix it.');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].filePath, 'src/main.rs');
  assert.equal(findings[0].line, 42);
  assert.match(findings[0].message, /mismatched types/);
  assert.equal(findings[0].severity, 'high');
});

test('parseGenericCommandOutput parses tsc-style file(line,col): message format', () => {
  const stdout = 'src/index.ts(10,3): error TS2345: bad argument';
  const findings = parseGenericCommandOutput('typecheck', stdout, '', 1, 'typecheck', 'Fix it.');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].filePath, 'src/index.ts');
  assert.equal(findings[0].line, 10);
  assert.match(findings[0].message, /TS2345/);
});

test('parseGenericCommandOutput parses Rust error headings', () => {
  const stderr = 'error[E0308]: mismatched types\n  --> src/main.rs:42:5';
  const findings = parseGenericCommandOutput('build', '', stderr, 1, 'build', 'Fix it.');

  // The heading line should be parsed as a rust heading, and the --> line as colon-style
  assert.ok(findings.length >= 1);
  const headingFinding = findings.find(f => f.message.includes('error[E0308]'));
  assert.ok(headingFinding, 'Should find the Rust error heading');
  assert.equal(headingFinding.severity, 'high');
});

test('parseGenericCommandOutput assigns medium severity to warnings', () => {
  const stderr = 'src/lib.rs:10:1: warning: unused variable';
  const findings = parseGenericCommandOutput('lint', '', stderr, 0, 'lint', 'Fix it.');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'medium');
});

test('parseGenericCommandOutput falls back to raw output when no patterns match', () => {
  const stderr = 'Something went wrong\nNo structured output here';
  const findings = parseGenericCommandOutput('test', '', stderr, 1, 'test', 'Fix it.');

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /Something went wrong/);
  assert.equal(findings[0].filePath, '(command output)');
});

test('parseGenericCommandOutput handles empty output with non-zero exit', () => {
  const findings = parseGenericCommandOutput('build', '', '', 137, 'build', 'Fix it.');

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /exited with code 137/);
});

test('parseGenericCommandOutput returns empty for success with no output', () => {
  const findings = parseGenericCommandOutput('test', '', '', 0, 'test', 'Fix it.');

  assert.equal(findings.length, 0);
});

// ── .vibecheckrc schema with commands ──────────────────────────────────

test('readVibecheckRc accepts commands field with string overrides', () => {
  const repoPath = createRepoFixture({
    '.vibecheckrc': JSON.stringify({
      commands: {
        test: 'cargo test --workspace',
        lint: 'cargo clippy --workspace -- -D warnings',
        build: 'cargo build --workspace',
        typecheck: null,
      },
    }),
  });

  const rc = readVibecheckRc(repoPath);
  assert.ok(rc);
  assert.ok(rc.commands);
  assert.equal(rc.commands.test, 'cargo test --workspace');
  assert.equal(rc.commands.lint, 'cargo clippy --workspace -- -D warnings');
  assert.equal(rc.commands.build, 'cargo build --workspace');
  assert.equal(rc.commands.typecheck, null);
  assert.equal(rc.commands.ci, undefined);
});

test('readVibecheckRc accepts commands with ci field', () => {
  const repoPath = createRepoFixture({
    '.vibecheckrc': JSON.stringify({
      commands: {
        ci: './scripts/ci.sh',
      },
    }),
  });

  const rc = readVibecheckRc(repoPath);
  assert.ok(rc);
  assert.ok(rc.commands);
  assert.equal(rc.commands.ci, './scripts/ci.sh');
});

test('readVibecheckRc rejects invalid commands field', () => {
  const repoPath = createRepoFixture({
    '.vibecheckrc': JSON.stringify({
      commands: {
        test: 42,
      },
    }),
  });

  assert.throws(() => readVibecheckRc(repoPath), /Invalid .vibecheckrc/);
});

test('readVibecheckRc works without commands field (backward compat)', () => {
  const repoPath = createRepoFixture({
    '.vibecheckrc': JSON.stringify({
      profile: 'cli',
    }),
  });

  const rc = readVibecheckRc(repoPath);
  assert.ok(rc);
  assert.equal(rc.commands, undefined);
});

// ── Execution-check runner command override behavior ───────────────────

test('execution-check runner uses custom command from opts.commands', async () => {
  // Verify the key data flow: .vibecheckrc commands make it
  // through to the RunOptions shape that runners receive.
  const { mergeWithRc } = await import('../lib/config/vibecheckrc');
  const merged = mergeWithRc(undefined, {
    commands: {
      test: 'cargo test',
      build: null,
    },
  });

  // The commands should be attached under the rc namespace
  const rc = (merged as Record<string, unknown>).rc as Record<string, unknown>;
  assert.ok(rc);
  assert.ok(rc.commands);
  const cmds = rc.commands as Record<string, string | null>;
  assert.equal(cmds.test, 'cargo test');
  assert.equal(cmds.build, null);
});
