#!/usr/bin/env npx tsx
/**
 * Test rill code examples from markdown files
 *
 * Usage:
 *   npx tsx scripts/test-examples.ts docs/guide.md
 *   npx tsx scripts/test-examples.ts docs/
 *
 * Mock host functions are provided through `use<ext:name> => $app`, then
 * called as `$app.fn()`.
 * Unknown functions are tracked and reported.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  createRuntimeContext,
  execute,
  extResolver,
  formatRillLiteral,
  formatValue,
  isCallable,
  parse,
  RillError,
  type ScriptNode,
} from '@rcrsr/rill';
import {
  createExtExtensionDict,
  createMockFunctions,
  createMockVariables,
} from './test-examples-mock-host.js';
import {
  analyzeBlock,
  expectedErrorCodeToken,
  extractRillBlocks,
  findMarkdownFiles,
  processFrontmatter,
  type CodeBlock,
} from './test-examples-fences.js';

interface TestResult {
  block: CodeBlock;
  success: boolean;
  error?: string;
  errorColumn?: number | undefined;
  skipped?: boolean;
  skipReason?: string;
}

// Track unknown functions across all tests
const unknownFunctions = new Map<string, Set<string>>();

function trackUnknownFunction(name: string, location: string): void {
  if (!unknownFunctions.has(name)) {
    unknownFunctions.set(name, new Set());
  }
  unknownFunctions.get(name)!.add(location);
}

// A block's final statement ending in an explicit capture (`=> $name`) is a
// deliberate closure definition, not a forgotten invocation — only flag a
// callable result when the last statement does not store it anywhere.
//
// A trailing `-> $name` is NOT recognized here. Syntactically that's a
// pipe-target invocation (the parser marks the target `Variable` node
// `isPipeTarget: true`, never `type: 'Capture'`), not a capture: it applies
// the piped value to whatever `$name` already holds rather than storing a
// new closure. Detecting it would require distinguishing "invocation that
// happens to no-op" from "deliberate closure definition", which the AST
// alone doesn't disambiguate — so only the unambiguous `=>` form is exempt.
function lastStatementEndsInCapture(ast: ScriptNode): boolean {
  const last = ast.statements[ast.statements.length - 1];
  if (!last) return false;
  const statement = last.type === 'AnnotatedStatement' ? last.statement : last;
  if (statement.type !== 'Statement') return false;
  const { pipes, terminator } = statement.expression;
  if (terminator?.type === 'Capture') return true;
  const lastPipe = pipes[pipes.length - 1];
  return lastPipe?.type === 'Capture';
}

async function testBlock(block: CodeBlock): Promise<TestResult> {
  const location = `${block.file}:${block.lineNumber}`;

  // Process frontmatter first
  const { code, variables: frontmatterVars } = processFrontmatter(block.code);

  // Check for skip conditions on the processed code. A trailing run of
  // ellipsis continuation lines is exempt from execution, but any executable
  // lines ahead of it still run. `# Error:` markers are never stripped and
  // never skip — they flip expectHalt below, so the block still runs and is
  // asserted to halt.
  const { skipReason, executableCode, expectHalt } = analyzeBlock(code);
  if (skipReason) {
    return { block, success: true, skipped: true, skipReason };
  }

  const mockFunctions = createMockFunctions();
  const ctx = createRuntimeContext({
    callbacks: {
      onLog: () => {}, // Suppress output
    },
    functions: mockFunctions,
    variables: { ...createMockVariables(), ...frontmatterVars },
    resolvers: { ext: extResolver },
    configurations: {
      resolvers: {
        ext: createExtExtensionDict(mockFunctions),
      },
    },
  });

  try {
    const ast = parse(executableCode);
    const exec = await execute(ast, ctx);
    if (block.expectedResult !== undefined) {
      const actual1 = formatValue(exec.result).trim();
      const actual2 = formatRillLiteral(exec.result).trim();
      const expected = block.expectedResult.trim();
      const normalized = expected.replace(/\s*\([^)]*\)\s*$/, '');
      if (
        expected !== actual1 &&
        expected !== actual2 &&
        normalized !== actual1 &&
        normalized !== actual2
      ) {
        return {
          block,
          success: false,
          error: `Result drift: expected \`${block.expectedResult}\`, got \`${actual1}\``,
          errorColumn: undefined,
        };
      }
    } else if (isCallable(exec.result) && !lastStatementEndsInCapture(ast)) {
      // A block with no `# Result:` annotation that ends in an uninvoked
      // callable almost always means the example forgot to apply it, rather
      // than intentionally documenting a callable value. A block whose last
      // statement stores the callable via an explicit capture (`=> $name`)
      // is a deliberate closure definition and is exempt.
      return {
        block,
        success: false,
        error: 'Block ends in an unapplied callable (result was never invoked)',
        errorColumn: undefined,
      };
    }
    if (expectHalt) {
      return {
        block,
        success: false,
        error:
          'Expected execution to halt (block carries a `# Error:` marker), but the block completed',
        errorColumn: undefined,
      };
    }
    return { block, success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorColumn =
      err instanceof RillError ? err.location?.column : undefined;

    if (expectHalt) {
      // Baseline assertion is halt-only — marker text is inconsistent across
      // docs, so we don't require it to match. When the marker does carry a
      // strict rill error code, assert the caught message contains it as a
      // cheap strengthening.
      const expectedToken = expectedErrorCodeToken(executableCode);
      if (expectedToken && !errorMessage.includes(expectedToken)) {
        return {
          block,
          success: false,
          error: `Expected halt to mention ${expectedToken}, but got: ${errorMessage}`,
          errorColumn,
        };
      }
      return { block, success: true };
    }

    // Track unknown functions
    const unknownMatch = errorMessage.match(
      /Unknown function: (\w+(?:::\w+)*)/
    );
    if (unknownMatch) {
      trackUnknownFunction(unknownMatch[1]!, location);
    }

    return { block, success: false, error: errorMessage, errorColumn };
  }
}

function formatLocation(block: CodeBlock): string {
  return `${block.file}:${block.lineNumber}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const filteredArgs = args.filter((a) => a !== '--json');

  if (filteredArgs.length === 0) {
    console.error(
      'Usage: npx tsx scripts/test-examples.ts [--json] <file-or-directory>...'
    );
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/test-examples.ts docs/guide.md');
    console.error('  npx tsx scripts/test-examples.ts docs/');
    console.error('  npx tsx scripts/test-examples.ts docs/ README.md');
    console.error('  npx tsx scripts/test-examples.ts --json docs/');
    process.exit(1);
  }

  for (const targetPath of filteredArgs) {
    if (!fs.existsSync(targetPath)) {
      console.error(`Path not found: ${targetPath}`);
      process.exit(1);
    }
  }

  // Accepts several targets so a run can cover docs/ and the root README in
  // one pass. Dedupe by resolved path: a file named explicitly may also sit
  // under a directory target (even under a differently spelled path, e.g. a
  // trailing slash or `./` prefix), and testing it twice would double-count
  // the totals. Keep the first-seen (unresolved) spelling for display so
  // reported paths stay relative when the caller passed relative targets.
  const seenByResolvedPath = new Map<string, string>();
  for (const file of filteredArgs.flatMap(findMarkdownFiles)) {
    const resolved = path.resolve(file);
    if (!seenByResolvedPath.has(resolved)) {
      seenByResolvedPath.set(resolved, file);
    }
  }
  const files = [...seenByResolvedPath.values()];

  if (files.length === 0) {
    console.error('No markdown files found');
    process.exit(1);
  }

  if (!jsonFlag) {
    console.log(`Testing rill examples in ${files.length} file(s)...\n`);
  }

  const allBlocks: CodeBlock[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const blocks = extractRillBlocks(content, file);
    allBlocks.push(...blocks);
  }

  if (allBlocks.length === 0) {
    if (!jsonFlag) {
      console.log('No ```rill code blocks found');
    }
    process.exit(0);
  }

  const results: TestResult[] = [];

  for (const block of allBlocks) {
    const result = await testBlock(block);
    results.push(result);

    if (!jsonFlag) {
      if (result.skipped) {
        process.stdout.write('s');
      } else if (result.success) {
        process.stdout.write('.');
      } else {
        process.stdout.write('F');
      }
    }
  }

  const failures = results.filter((r) => !r.success && !r.skipped);
  const passes = results.filter((r) => r.success && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  // Skip-ratio guard: a spike in skipped rill fences usually means the marker
  // detection in analyzeBlock() is over-matching again (e.g. back to treating
  // any block that merely contains "# Error:" or "# ..." anywhere as fully
  // skippable, instead of only a trailing run of marker lines). The threshold
  // is pinned just above the ratio measured immediately after that fix landed
  // (2/660 skipped ≈ 0.30% across docs/ + README.md), so a regression back
  // toward whole-block skipping fails the run instead of silently widening.
  // Pinned tight enough that a single additional skip (3/660 ≈ 0.45%) already
  // trips the guard, rather than requiring the count to double first.
  const SKIP_RATIO_THRESHOLD = 0.0035; // 0.35%
  const skipRatio =
    allBlocks.length > 0 ? skipped.length / allBlocks.length : 0;
  const skipRatioExceeded = skipRatio > SKIP_RATIO_THRESHOLD;

  if (jsonFlag) {
    // JSONL output: one JSON object per line for each failure
    for (const result of failures) {
      const obj: Record<string, unknown> = {
        file: result.block.file,
        line: result.block.lineNumber,
        message: result.error,
      };
      if (result.errorColumn !== undefined) {
        obj['column'] = result.errorColumn;
      }
      console.log(JSON.stringify(obj));
    }
    if (skipRatioExceeded) {
      console.log(
        JSON.stringify({
          kind: 'skip-ratio-exceeded',
          skipped: skipped.length,
          total: allBlocks.length,
          ratio: skipRatio,
          threshold: SKIP_RATIO_THRESHOLD,
          message: `Skipped ${skipped.length}/${allBlocks.length} rill fences (${(skipRatio * 100).toFixed(2)}%), exceeding the ${(SKIP_RATIO_THRESHOLD * 100).toFixed(2)}% threshold`,
        })
      );
    }
  } else {
    console.log('\n');

    if (failures.length > 0) {
      console.log('Failures:\n');

      for (const result of failures) {
        console.log(`  ${formatLocation(result.block)}`);
        console.log(`    ${result.error}`);
        console.log(`    Code: ${result.block.code.split('\n')[0]}...`);
        console.log('');
      }
    }

    // Report unknown functions
    if (unknownFunctions.size > 0) {
      console.log(
        'Unknown functions (need a mock, or a `use<ext:name> => $app` import in docs):\n'
      );
      for (const [name, locations] of unknownFunctions) {
        console.log(`  ${name}:`);
        for (const loc of [...locations].slice(0, 3)) {
          console.log(`    - ${loc}`);
        }
        if (locations.size > 3) {
          console.log(`    ... and ${locations.size - 3} more`);
        }
      }
      console.log('');
    }

    console.log(
      `${passes.length} passed, ${failures.length} failed, ${skipped.length} skipped, ${allBlocks.length} total`
    );

    if (skipRatioExceeded) {
      console.log(
        `Skip ratio guard: ${skipped.length}/${allBlocks.length} (${(skipRatio * 100).toFixed(2)}%) skipped, exceeding the ${(SKIP_RATIO_THRESHOLD * 100).toFixed(2)}% threshold`
      );
    }
  }

  if (failures.length > 0 || skipRatioExceeded) {
    process.exit(1);
  }
}

main();
