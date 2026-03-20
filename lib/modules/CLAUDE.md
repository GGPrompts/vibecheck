# Module System

20 analysis modules that scan repos and produce scored findings.

## Module Registry

Modules self-register via `registerModule(definition, runner)` in `registry.ts`. All registrations happen in `register-all.ts` which imports each module's `index.ts`.

## Module Interface

```typescript
interface ModuleDefinition {
  id: string;            // e.g. 'complexity'
  name: string;          // e.g. 'Code Complexity'
  description: string;
  category: 'static' | 'ai';
  defaultEnabled: boolean;
}

interface ModuleRunner {
  canRun(repoPath: string): Promise<boolean>;
  run(repoPath: string, opts: RunOptions): Promise<ModuleResult>;
}

interface RunOptions {
  onProgress?: (pct: number, msg: string) => void;
  signal?: AbortSignal;
  fileRoles?: Map<string, string[]>;  // from classifier
}

interface ModuleResult {
  score: number;         // 0-100
  confidence: number;    // 0.0-1.0
  findings: Finding[];
  metrics: Record<string, unknown>;
  summary: string;
}
```

## Modules

### Static (defaultEnabled: true)
| ID | Tool | What it checks |
|----|------|----------------|
| security | npm audit | Known CVEs in dependencies |
| dependencies | npm outdated | Outdated packages by semver gap |
| complexity | ts-morph | Cyclomatic complexity, LOC, maintainability |
| git-health | gitlog | Bus factor, churn hotspots, stale TODOs |
| dead-code | knip | Unused exports, files, dependencies |
| circular-deps | depcruise | Circular import chains |
| test-coverage | coverage JSON/LCOV | Line/branch/function coverage |
| compliance | ast-grep | HIPAA and custom structural rules |
| ast-rules | ast-grep | User-defined YAML pattern rules |
| type-safety | ts-morph | `any` usage, tsconfig strict flags, type assertions, ts-ignore directives |
| secrets-scan | regex + entropy | Hardcoded API keys, tokens, passwords, private keys, connection strings |
| config-quality | parsers | tsconfig, package.json, eslint, gitignore, env, Dockerfile, CI config |

### Runtime (defaultEnabled: false)
| ID | Tool | What it checks |
|----|------|----------------|
| api-health | fetch + dev server | 500 crashes, missing validation, slow responses |

### AI-Powered (require ANTHROPIC_API_KEY)
| ID | What it checks |
|----|----------------|
| naming-quality | Variable/function naming clarity |
| doc-staleness | Documentation freshness vs code |
| arch-smells | God objects, layer violations, feature envy |
| test-quality | Weak assertions, missing edge cases |
| doc-accuracy | Checks if docs match actual code structure |
| context-conflicts | Finds contradictions between CLAUDE.md, README, comments, code |
| error-handling | Empty catches, swallowed errors, missing cleanup, resource leaks |

## Adding a New Module

1. Create `lib/modules/<name>/index.ts`
2. Import and call `registerModule(definition, runner)`
3. Add `import './<name>'` to `register-all.ts`
4. The module will appear in settings UI and scan orchestration automatically

## File Role Awareness

Modules receive `opts.fileRoles` (Map of filePath to role array) from the classifier. Use this to adjust behavior:
- dead-code: skips unused export warnings for `public-api`, `ui-kit`, `provider` files
- complexity: higher LOC threshold (800) for `api-route`, skips LOC for `ui-kit`
- git-health: downgrades bus-factor to `info` for `cli-entrypoint`, `mcp-tool`, `provider`

## Orchestrator

`orchestrator.ts` runs enabled modules, applies profile config, merges `.vibecheckrc` overrides, passes file roles, and aggregates results into a weighted overall score via `scoring.ts`.
