import { existsSync, statSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { Project, SyntaxKind, SourceFile, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression } from 'ts-morph';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

type FunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression;

/**
 * Collect all source files matching our extensions, excluding typical build/vendor dirs.
 */
function collectSourceFiles(dir: string, files: string[] = []): string[] {
  const excludeDirs = new Set([
    'node_modules',
    '.next',
    'dist',
    'build',
    'out',
    '.git',
    'coverage',
    '.turbo',
    '.vercel',
    '__pycache__',
    '.cache',
  ]);
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!excludeDirs.has(entry.name)) {
        collectSourceFiles(fullPath, files);
      }
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (extensions.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Approximate cyclomatic complexity of a function by counting branching constructs.
 * CC = 1 + count of (if, else if, for, while, do-while, switch case, catch, &&, ||, ?:)
 */
function calculateCyclomaticComplexity(node: FunctionLike): number {
  let complexity = 1;
  const text = node.getText();

  // Count control flow keywords in the function text by walking descendants
  node.forEachDescendant((child) => {
    switch (child.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CaseClause:
      case SyntaxKind.CatchClause:
      case SyntaxKind.ConditionalExpression:
        complexity++;
        break;
      case SyntaxKind.BinaryExpression: {
        const opKind = child.getChildAtIndex(1)?.getKind();
        if (
          opKind === SyntaxKind.AmpersandAmpersandToken ||
          opKind === SyntaxKind.BarBarToken
        ) {
          complexity++;
        }
        break;
      }
    }
  });

  return complexity;
}

/**
 * Get the name of a function-like node.
 */
function getFunctionName(node: FunctionLike): string {
  if ('getName' in node && typeof node.getName === 'function') {
    return node.getName() ?? '<anonymous>';
  }
  // For arrow functions / function expressions, try to get the variable name
  const parent = node.getParent();
  if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
    const varDecl = parent;
    if ('getName' in varDecl && typeof varDecl.getName === 'function') {
      return varDecl.getName() as string;
    }
  }
  return '<anonymous>';
}

interface FileAnalysis {
  filePath: string;
  relativePath: string;
  loc: number;
  functionCount: number;
  classCount: number;
  functions: Array<{
    name: string;
    complexity: number;
    startLine: number;
    loc: number;
  }>;
  maxComplexity: number;
  avgComplexity: number;
}

function analyzeSourceFile(
  sourceFile: SourceFile,
  repoPath: string
): FileAnalysis {
  const filePath = sourceFile.getFilePath();
  const relativePath = relative(repoPath, filePath);
  const loc = sourceFile.getEndLineNumber();

  // Count classes
  const classCount = sourceFile.getClasses().length;

  // Gather all function-like declarations
  const functionNodes: FunctionLike[] = [
    ...sourceFile.getFunctions(),
    ...sourceFile.getClasses().flatMap((c) => c.getMethods()),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
  ];

  const functions = functionNodes.map((fn) => {
    const name = getFunctionName(fn);
    const complexity = calculateCyclomaticComplexity(fn);
    const startLine = fn.getStartLineNumber();
    const fnLoc = fn.getEndLineNumber() - startLine + 1;
    return { name, complexity, startLine, loc: fnLoc };
  });

  const maxComplexity =
    functions.length > 0
      ? Math.max(...functions.map((f) => f.complexity))
      : 0;
  const avgComplexity =
    functions.length > 0
      ? functions.reduce((sum, f) => sum + f.complexity, 0) / functions.length
      : 0;

  return {
    filePath,
    relativePath,
    loc,
    functionCount: functions.length,
    classCount,
    functions,
    maxComplexity,
    avgComplexity,
  };
}

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    // Any repo can have code files
    return true;
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Collecting source files...');

    const allFiles = collectSourceFiles(repoPath);

    if (allFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { totalFiles: 0 },
        summary: 'No JS/TS source files found.',
      };
    }

    // Sort by file size descending, cap at 500
    const filesWithSize = allFiles
      .map((f) => {
        try {
          return { path: f, size: statSync(f).size };
        } catch {
          return { path: f, size: 0 };
        }
      })
      .sort((a, b) => b.size - a.size)
      .slice(0, 500);

    opts.onProgress?.(
      10,
      `Analyzing ${filesWithSize.length} files (of ${allFiles.length} total)...`
    );

    // Create ts-morph project
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 2, // React
        noEmit: true,
        skipLibCheck: true,
      },
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });

    for (const file of filesWithSize) {
      try {
        project.addSourceFileAtPath(file.path);
      } catch {
        // Skip files that can't be parsed
      }
    }

    const sourceFiles = project.getSourceFiles();
    const analyses: FileAnalysis[] = [];
    const findings: Finding[] = [];

    let processed = 0;
    for (const sf of sourceFiles) {
      try {
        const analysis = analyzeSourceFile(sf, repoPath);
        analyses.push(analysis);

        // Generate findings for high-complexity functions
        for (const fn of analysis.functions) {
          if (fn.complexity > 10) {
            const message = `Function "${fn.name}" has cyclomatic complexity ${fn.complexity} (threshold: 10)`;
            const severity =
              fn.complexity > 25
                ? 'high' as const
                : fn.complexity > 15
                  ? 'medium' as const
                  : 'low' as const;

            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity,
              filePath: analysis.relativePath,
              line: fn.startLine,
              message,
              category: 'high-complexity',
              suggestion: `Consider breaking "${fn.name}" into smaller functions. Cyclomatic complexity > 10 indicates too many branching paths.`,
            };

            findings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint('complexity', finding),
            });
          }
        }

        // Finding for very long files
        // Adjust LOC threshold based on file role
        const fileRolesForAnalysis = opts.fileRoles?.get(analysis.relativePath);
        const isUiKit = fileRolesForAnalysis?.includes('ui-kit') ?? false;
        const isApiRoute = fileRolesForAnalysis?.includes('api-route') ?? false;
        const locThreshold = isApiRoute ? 800 : 500;

        if (!isUiKit && analysis.loc > locThreshold) {
          const message = `File has ${analysis.loc} lines of code (threshold: ${locThreshold})`;
          const severity =
            analysis.loc > locThreshold * 2 ? ('high' as const) : ('medium' as const);

          const finding: Omit<Finding, 'id' | 'fingerprint'> = {
            severity,
            filePath: analysis.relativePath,
            message,
            category: 'long-file',
            suggestion: `Consider splitting this file into smaller modules. Large files are harder to understand and maintain.`,
          };

          findings.push({
            ...finding,
            id: nanoid(),
            fingerprint: generateFingerprint('complexity', finding),
          });
        }
      } catch {
        // Skip files that fail analysis
      }

      processed++;
      if (processed % 50 === 0) {
        opts.onProgress?.(
          10 + Math.round((processed / sourceFiles.length) * 80),
          `Analyzed ${processed} of ${sourceFiles.length} files...`
        );
      }
    }

    opts.onProgress?.(90, 'Computing maintainability index...');

    // Calculate aggregate metrics
    const totalLOC = analyses.reduce((sum, a) => sum + a.loc, 0);
    const totalFunctions = analyses.reduce((sum, a) => sum + a.functionCount, 0);
    const totalClasses = analyses.reduce((sum, a) => sum + a.classCount, 0);

    const allComplexities = analyses.flatMap((a) =>
      a.functions.map((f) => f.complexity)
    );
    const avgComplexity =
      allComplexities.length > 0
        ? allComplexities.reduce((s, c) => s + c, 0) / allComplexities.length
        : 1;
    const maxComplexity =
      allComplexities.length > 0 ? Math.max(...allComplexities) : 0;

    const avgLOC =
      analyses.length > 0 ? totalLOC / analyses.length : 1;

    // Halstead volume approximation: use LOC as proxy
    // Real Halstead would require counting operators/operands
    const avgVolume = Math.max(avgLOC * 2, 1);

    // Maintainability Index approximation:
    // MI = 171 - 5.2 * ln(avgVolume) - 0.23 * avgComplexity - 16.2 * ln(avgLOC)
    // Scaled to 0-100
    const rawMI =
      171 -
      5.2 * Math.log(avgVolume) -
      0.23 * avgComplexity -
      16.2 * Math.log(Math.max(avgLOC, 1));

    const maintainabilityIndex = Math.max(
      0,
      Math.min(100, Math.round(rawMI * (100 / 171)))
    );

    const metrics: Record<string, number> = {
      totalFiles: analyses.length,
      totalLOC,
      totalFunctions,
      totalClasses,
      avgComplexity: Math.round(avgComplexity * 100) / 100,
      maxComplexity,
      maintainabilityIndex,
      highComplexityFunctions: allComplexities.filter((c) => c > 10).length,
      longFiles: analyses.filter((a) => a.loc > 500).length,
    };

    // Score is the maintainability index
    const score = maintainabilityIndex;

    opts.onProgress?.(100, 'Complexity analysis complete.');

    const summary = [
      `Analyzed ${analyses.length} files (${totalLOC.toLocaleString()} LOC, ${totalFunctions} functions).`,
      `Maintainability index: ${maintainabilityIndex}/100.`,
      `Average complexity: ${metrics.avgComplexity}, max: ${maxComplexity}.`,
      findings.length > 0
        ? `Found ${findings.length} complexity issues.`
        : 'No complexity issues detected.',
    ].join(' ');

    return {
      score,
      confidence: analyses.length >= 10 ? 1.0 : 0.7,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'complexity',
    name: 'Complexity',
    description: 'Code complexity analysis via AST',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
