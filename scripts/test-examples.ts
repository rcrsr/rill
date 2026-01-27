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
  import('../src/runtime/index.js').HostFunctionDefinition
> {
  return {
    // Primary app:: namespace (preferred convention for docs)
    'app::prompt': {
      params: [{ name: 'text', type: 'string' }],
      fn: () => 'mock LLM response',
    },
    'app::fetch': {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '{"status": "ok"}',
    },
    'app::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'app::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },
    'app::exec': {
      params: [{ name: 'cmd', type: 'string' }],
      fn: () => ['output', 0],
    },
    'app::error': {
      params: [{ name: 'msg', type: 'string' }],
      fn: (msg) => {
        throw new Error(String(msg));
      },
    },
    'app::sleep': { params: [{ name: 'ms', type: 'number' }], fn: () => null },
    'app::process': {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'processed',
    },
    'app::validate': {
      params: [{ name: 'value', type: 'string' }],
      fn: (v) => v,
    },
    'app::command': {
      params: [{ name: 'cmd', type: 'string' }],
      fn: () => 'output',
    },
    'app::attempt': {
      params: [{ name: 'action', type: 'string' }],
      fn: () => 'success',
    },
    'app::pause': { params: [{ name: 'ms', type: 'number' }], fn: () => null },
    'app::call': {
      params: [
        { name: 'fn_name', type: 'string' },
        { name: 'args', type: 'dict' },
      ],
      fn: () => 'called',
    },

    // IO namespace
    'io::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'io::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },
    'io::file::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'io::file::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },

    // Math namespace
    'math::add': {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (a, b) => (a as number) + (b as number),
    },
    'math::multiply': {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (a, b) => (a as number) * (b as number),
    },

    // HTTP namespace
    'http::get': {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '{"data": "mock"}',
    },
    'http::post': {
      params: [
        { name: 'url', type: 'string' },
        { name: 'data', type: 'string' },
      ],
      fn: () => '{"status": "ok"}',
    },

    // String namespace (for host-provided string utils, not built-in methods)
    'str::upper': {
      params: [{ name: 'text', type: 'string' }],
      fn: (s) => String(s).toUpperCase(),
    },
    'str::lower': {
      params: [{ name: 'text', type: 'string' }],
      fn: (s) => String(s).toLowerCase(),
    },

    // FS namespace
    'fs::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'fs::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },

    // Legacy unnamespaced - these should be migrated to app:: in docs
    prompt: {
      params: [{ name: 'text', type: 'string' }],
      fn: () => 'mock LLM response',
    },
    fetch: {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '{"status": "ok"}',
    },
    fetch_page: {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '<html>page</html>',
    },
    exec: {
      params: [{ name: 'cmd', type: 'string' }],
      fn: () => ['output', 0],
    },
    error: {
      params: [{ name: 'msg', type: 'string' }],
      fn: (msg) => {
        throw new Error(String(msg));
      },
    },
    process: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'processed',
    },
    proceed: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'proceeded',
    },
    handle: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'handled',
    },
    validate: { params: [{ name: 'value', type: 'string' }], fn: (v) => v },
    check_status: { params: [], fn: () => 'ok' },
    get_page: {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '<html></html>',
    },
    retry: {
      params: [{ name: 'action', type: 'string' }],
      fn: () => 'retried',
    },
    process_config: {
      params: [{ name: 'config', type: 'string' }],
      fn: (v) => v,
    },
    process_content: {
      params: [{ name: 'content', type: 'string' }],
      fn: (v) => v,
    },
    save_content: {
      params: [{ name: 'content', type: 'string' }],
      fn: () => true,
    },
    command: { params: [{ name: 'cmd', type: 'string' }], fn: () => 'output' },
    skip: { params: [{ name: 'reason', type: 'string' }], fn: () => null },
    attempt: {
      params: [{ name: 'action', type: 'string' }],
      fn: () => 'success',
    },
    pause: { params: [{ name: 'ms', type: 'number' }], fn: () => null },
    slow_process: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'processed',
    },
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
