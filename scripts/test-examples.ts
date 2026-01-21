#!/usr/bin/env npx tsx
/**
 * Test rill code examples from markdown files
 *
 * Usage:
 *   npx tsx scripts/test-examples.ts docs/guide.md
 *   npx tsx scripts/test-examples.ts docs/
 *
 * Mock host functions are provided with app:: namespace.
 * Unknown functions are tracked and reported.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  createRuntimeContext,
  execute,
  parse,
  RillError,
  type RillValue,
} from '../src/index.js';

interface CodeBlock {
  code: string;
  lineNumber: number;
  file: string;
}

interface TestResult {
  block: CodeBlock;
  success: boolean;
  error?: string;
  errorColumn?: number;
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

// Mock host functions - all prefixed with app:: to clearly mark as host-provided
// Built-in functions (enumerate, identity, json, log, parse_*, range, repeat, type)
// and methods (.len, .trim, .upper, .lower, .join, etc.) are NOT mocked here
function createMockFunctions(): Record<
  string,
  (...args: RillValue[]) => RillValue | Promise<RillValue>
> {
  return {
    // Primary app:: namespace (preferred convention for docs)
    'app::prompt': () => 'mock LLM response',
    'app::fetch': () => '{"status": "ok"}',
    'app::read': () => 'file contents',
    'app::write': () => true,
    'app::exec': () => ['output', 0],
    'app::error': (msg) => {
      throw new Error(String(msg));
    },
    'app::sleep': () => null,
    'app::process': () => 'processed',
    'app::validate': (v) => v,
    'app::command': () => 'output',
    'app::attempt': () => 'success',
    'app::pause': () => null,

    // IO namespace
    'io::read': () => 'file contents',
    'io::write': () => true,
    'io::file::read': () => 'file contents',
    'io::file::write': () => true,

    // Math namespace
    'math::add': (a, b) => (a as number) + (b as number),
    'math::multiply': (a, b) => (a as number) * (b as number),

    // HTTP namespace
    'http::get': () => '{"data": "mock"}',
    'http::post': () => '{"status": "ok"}',

    // String namespace (for host-provided string utils, not built-in methods)
    'str::upper': (s) => String(s).toUpperCase(),
    'str::lower': (s) => String(s).toLowerCase(),

    // FS namespace
    'fs::read': () => 'file contents',
    'fs::write': () => true,

    // Legacy unnamespaced - these should be migrated to app:: in docs
    prompt: () => 'mock LLM response',
    fetch: () => '{"status": "ok"}',
    fetch_page: () => '<html>page</html>',
    exec: () => ['output', 0],
    error: (msg) => {
      throw new Error(String(msg));
    },
    process: () => 'processed',
    proceed: () => 'proceeded',
    handle: () => 'handled',
    validate: (v) => v,
    check_status: () => 'ok',
    get_page: () => '<html></html>',
    retry: () => 'retried',
    process_config: (v) => v,
    process_content: (v) => v,
    save_content: () => true,
    command: () => 'output',
    skip: () => null,
    attempt: () => 'success',
    pause: () => null,
    slow_process: () => 'processed',
  };
}

function extractRillBlocks(content: string, filePath: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockStart = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith('```rill')) {
      inBlock = true;
      blockStart = i + 1; // 1-indexed line number
      blockLines = [];
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      blocks.push({
        code: blockLines.join('\n'),
        lineNumber: blockStart + 1, // Line after the opening fence
        file: filePath,
      });
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

function findMarkdownFiles(targetPath: string): string[] {
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    return targetPath.endsWith('.md') ? [targetPath] : [];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(targetPath);

    for (const entry of entries) {
      const fullPath = path.join(targetPath, entry);
      const entryStat = fs.statSync(fullPath);

      if (entryStat.isFile() && entry.endsWith('.md')) {
        files.push(fullPath);
      } else if (entryStat.isDirectory() && !entry.startsWith('.')) {
        files.push(...findMarkdownFiles(fullPath));
      }
    }

    return files;
  }

  return [];
}

// Strip YAML frontmatter and extract variables
function processFrontmatter(code: string): {
  code: string;
  variables: Record<string, RillValue>;
} {
  const frontmatterMatch = code.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { code, variables: {} };
  }

  const frontmatter = frontmatterMatch[1]!;
  const restCode = frontmatterMatch[2]!;
  const variables: Record<string, RillValue> = {};

  // Parse simple YAML-like args: "args: name: type, name2: type2"
  const argsMatch = frontmatter.match(/args:\s*(.+)/);
  if (argsMatch) {
    const argPairs = argsMatch[1]!.split(',');
    for (const pair of argPairs) {
      const nameMatch = pair.trim().match(/^(\w+):/);
      if (nameMatch) {
        // Provide mock values based on type hints
        const name = nameMatch[1]!;
        if (pair.includes('string')) {
          variables[name] = 'mock_' + name;
        } else if (pair.includes('number')) {
          variables[name] = 42;
        } else if (pair.includes('bool')) {
          variables[name] = true;
        } else {
          variables[name] = 'mock_value';
        }
      }
    }
  }

  return { code: restCode, variables };
}

// Check if block should be skipped (pseudo-code, syntax demos)
function shouldSkipBlock(code: string): string | null {
  // Skip blocks with placeholder syntax like "collection -> each body"
  if (/^\s*\w+\s+->\s+(each|map|filter|fold)\s+\w+\s*$/m.test(code)) {
    return 'pseudo-code syntax';
  }

  // Skip blocks with "condition ? then-body" pseudo-syntax
  if (/^\s*condition\s+\?/.test(code)) {
    return 'pseudo-code syntax';
  }

  // Skip blocks that are pure comments
  if (
    code
      .split('\n')
      .every((line) => line.trim().startsWith('#') || !line.trim())
  ) {
    return 'comments only';
  }

  // Skip blocks with "..." continuation markers (but not in strings or spread)
  if (/(?<!\[)\.\.\.[^$\]]/.test(code) && !/"\.\.\."/.test(code)) {
    return 'contains ellipsis placeholder';
  }

  // Skip blocks with heredocs as function arguments (not yet supported)
  if (/\w+\s*\(\s*<<\w+/.test(code)) {
    return 'heredoc as function argument (not supported)';
  }

  // Skip blocks demonstrating expected errors
  if (/# Error:|# ERROR:|# error:/.test(code)) {
    return 'expected error example';
  }

  return null;
}

// Common mock variables for examples - only input variables, not ones typically assigned
function createMockVariables(): Record<string, RillValue> {
  return {
    // Input variables commonly read in examples
    email: 'test@example.com',
    items: ['a', 'b', 'c'],
    list: [1, 2, 3],
    config: { key: 'value', count: 42 },
    data: { items: [1, 2, 3], name: 'test' },
    input: 'mock input',
    response: 'mock LLM response',
    file: '/path/to/file.txt',
  };
}

async function testBlock(block: CodeBlock): Promise<TestResult> {
  const location = `${block.file}:${block.lineNumber}`;

  // Process frontmatter first
  const { code, variables: frontmatterVars } = processFrontmatter(block.code);

  // Check for skip conditions on the processed code
  const skipReason = shouldSkipBlock(code);
  if (skipReason) {
    return { block, success: true, skipped: true, skipReason };
  }

  const ctx = createRuntimeContext({
    callbacks: {
      onLog: () => {}, // Suppress output
    },
    functions: createMockFunctions(),
    variables: { ...createMockVariables(), ...frontmatterVars },
  });

  try {
    const ast = parse(code);
    await execute(ast, ctx);
    return { block, success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorColumn =
      err instanceof RillError ? err.location?.column : undefined;

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
      'Usage: npx tsx scripts/test-examples.ts [--json] <file-or-directory>'
    );
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/test-examples.ts docs/guide.md');
    console.error('  npx tsx scripts/test-examples.ts docs/');
    console.error('  npx tsx scripts/test-examples.ts --json docs/');
    process.exit(1);
  }

  const targetPath = filteredArgs[0]!;

  if (!fs.existsSync(targetPath)) {
    console.error(`Path not found: ${targetPath}`);
    process.exit(1);
  }

  const files = findMarkdownFiles(targetPath);

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

  if (jsonFlag) {
    // JSONL output: one JSON object per line for each failure
    for (const result of failures) {
      const obj: Record<string, unknown> = {
        file: result.block.file,
        line: result.block.lineNumber,
        message: result.error,
      };
      if (result.errorColumn !== undefined) {
        obj.column = result.errorColumn;
      }
      console.log(JSON.stringify(obj));
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
      console.log('Unknown functions (need mock or app:: prefix in docs):\n');
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
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
