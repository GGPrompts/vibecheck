# AI Integration

AI-powered analysis via Claude (API, CLI, or Codex).

## Providers

Three interchangeable providers implementing `AIProvider` interface (`providers/types.ts`):

| Provider | How it works | Auth |
|----------|-------------|------|
| `claude-api` | Anthropic SDK, direct API calls | `ANTHROPIC_API_KEY` env var |
| `claude-cli` | Spawns `claude -p` subprocess | Claude Max subscription |
| `codex` | Spawns Codex CLI for cross-model audits | Codex CLI installed |

Provider selection: `client.ts` manages active provider. Tier config (`lib/config/tiers.ts`) determines which model is used per tier (Haiku for pro, Sonnet for max, Sonnet+Opus for max-x20).

## AI Modules

Four AI-powered scan modules in `lib/modules/` (naming-quality, doc-staleness, arch-smells, test-quality). Each has a system prompt in `prompts/` defining the analysis criteria. Modules send sampled source files to Claude and parse structured JSON responses.

## Audit System

Full AI audit flow in `lib/audit/`:

- **runner.ts** — Orchestrates per-module AI audits. Selects high-value files (by size + directory diversity), sends to provider with module-specific prompts, parses findings. Respects tier model selection and coverage settings.
- **prompts.ts** — Module-specific system prompts for audits. Supports custom overrides from `.vibecheckrc` `auditPrompts` field.
- **event-emitter.ts** — SSE event broadcasting for real-time audit progress.

## Token Management

- `token-tracker.ts` — Per-scan token budget (default 100k, configurable via `.vibecheckrc` `aiTokenBudget`)
- `sampling.ts` — File selection for AI analysis. Prioritizes larger files, ensures directory diversity, caps per module.
- `pricing.ts` — Token cost estimation per model.
- `model-routing.ts` — Routes modules to appropriate model based on tier.

## Supported Languages

Audits work on: TypeScript, JavaScript, Go, Python, Rust, Java, Kotlin, Ruby, Swift, C/C++, C#, PHP, Lua, Zig.
