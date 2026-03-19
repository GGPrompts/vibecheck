# Compliance Module

Structural pattern matching for regulatory compliance using [ast-grep](https://ast-grep.github.io/).

## How It Works

The compliance module uses ast-grep's NAPI bindings to parse source code into ASTs and search for structural patterns that indicate compliance violations. Unlike regex-based scanners, ast-grep understands code structure -- it matches on the AST, not raw text.

## Rule Format

Rules are defined as TypeScript objects implementing the `ComplianceRule` interface:

```ts
import type { Severity } from '../../types';

interface ComplianceRule {
  id: string;           // Unique rule identifier
  name: string;         // Human-readable rule name
  description: string;  // What the rule detects
  pattern: string;      // ast-grep structural pattern
  language: string;     // 'typescript' | 'javascript'
  severity: Severity;   // 'critical' | 'high' | 'medium' | 'low' | 'info'
  hipaaCategory: string; // Regulatory category (e.g., 'Privacy Rule')
  hipaaRef: string;     // Section reference (e.g., '§164.312(a)(1)')
  message: string;      // Explanation shown to the user
  suggestion: string;   // Recommended fix
}
```

## ast-grep Pattern Syntax

ast-grep patterns use structural matching:

- `$VAR` matches any single AST node (expression, identifier, etc.)
- `$$$` matches zero or more nodes (spread/variadic)
- Literal code matches itself structurally

Examples:

| Pattern | Matches |
|---------|---------|
| `console.log($ARG)` | `console.log(x)`, `console.log("hello")` |
| `console.log($$$)` | `console.log()`, `console.log(a, b, c)` |
| `res.json({ $$$, ssn, $$$ })` | `res.json({ name, ssn, id })` |
| `localStorage.setItem($K, $V)` | Any localStorage.setItem call |

Full syntax reference: https://ast-grep.github.io/guide/pattern-syntax.html

## Adding New Rules

### 1. Create a new rule file

Create a file in `rules/` for your compliance standard:

```ts
// rules/soc2.ts
import type { ComplianceRule } from './hipaa'; // reuse the interface

export const soc2Rules: ComplianceRule[] = [
  {
    id: 'soc2-unencrypted-pii',
    name: 'Unencrypted PII Storage',
    description: 'Detects PII stored without encryption',
    pattern: 'localStorage.setItem($KEY, $VALUE)',
    language: 'typescript',
    severity: 'high',
    hipaaCategory: 'CC6.1', // SOC 2 control
    hipaaRef: 'CC6.1',
    message: 'Data stored in localStorage without encryption.',
    suggestion: 'Encrypt data before storing in browser storage.',
  },
];
```

### 2. Register the module

In `index.ts`, import and register:

```ts
import { soc2Rules } from './rules/soc2';

registerModule(
  {
    id: 'compliance-soc2',
    name: 'SOC 2 Compliance',
    category: 'static',
    defaultEnabled: false,
  },
  createComplianceRunner(soc2Rules)
);
```

### 3. Update register-all.ts

Add the import to `lib/modules/register-all.ts` if using a separate module file.

## Architecture

```
compliance/
  index.ts          - Module registration and runner factory
  scanner.ts        - ast-grep scanning wrapper (file walking + pattern matching)
  rules/
    hipaa.ts        - HIPAA-specific rule definitions
    (soc2.ts)       - Add more standards here
  README.md         - This file
```
