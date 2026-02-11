#!/usr/bin/env -S pnpm exec tsx
/**
 * Test Host for @rcrsr/rill-ext-claude-code
 *
 * Wires up the Claude Code extension with the rill runtime for testing.
 * Executes rill scripts against a live Claude CLI instance.
 *
 * Prerequisites:
 * - node-pty native module must be built for your platform:
 *     cd node_modules/node-pty && npx node-gyp rebuild
 *   Or reinstall with: pnpm install (triggers native compilation)
 * - claude binary must be in PATH
 *
 * Usage:
 *   pnpm exec tsx examples/test-host.ts                  # Run built-in demo
 *   pnpm exec tsx examples/test-host.ts --help           # Show help
 *   pnpm exec tsx examples/test-host.ts -e 'expr'        # Run inline expression
 *   pnpm exec tsx examples/test-host.ts script.rill      # Run script file
 */

import { readFile } from 'node:fs/promises';
import {
  parse,
  execute,
  createRuntimeContext,
  hoistExtension,
} from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';

// ============================================================
// CONSTANTS
// ============================================================

const BUILT_IN_DEMO = `claude_code::prompt("What is 2 + 2?") => $r
$r.result`;

const HELP_TEXT = `
Test Host for @rcrsr/rill-ext-claude-code

Usage:
  test-host.ts                  Run built-in demo script
  test-host.ts --help           Show this help message
  test-host.ts -h               Show this help message
  test-host.ts -e '<expr>'      Run inline expression
  test-host.ts <file>           Run script from file

Examples:
  test-host.ts -e 'claude_code::prompt("Hello") -> log'
  test-host.ts my-script.rill

Prerequisites:
  - node-pty native module must be built for your platform
    Rebuild with: cd node_modules/node-pty && npx node-gyp rebuild
  - claude binary must be in PATH
`;

// ============================================================
// HELPERS
// ============================================================

/**
 * Format RillValue for console output.
 *
 * @param value - Value to format
 * @returns Human-readable string
 */
function formatOutput(value: RillValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && '__type' in value) {
    return '[closure]';
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Parse CLI arguments and determine source to execute.
 *
 * @param argv - Command-line arguments
 * @returns Source code to execute
 */
async function parseArgs(argv: string[]): Promise<string> {
  // Help flag
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Inline expression
  const eIndex = argv.indexOf('-e');
  if (eIndex !== -1 && eIndex + 1 < argv.length) {
    return argv[eIndex + 1] as string;
  }

  // File argument
  if (argv.length > 0 && !argv[0]!.startsWith('-')) {
    const filePath = argv[0]!;
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to read file: ${message}`);
      process.exit(1);
    }
  }

  // No args: use built-in demo
  return BUILT_IN_DEMO;
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  try {
    // Parse CLI arguments
    const source = await parseArgs(process.argv.slice(2));

    // Dynamic import: load native module only after --help check
    let createClaudeCodeExtension: (typeof import('../src/index.js'))['createClaudeCodeExtension'];
    try {
      ({ createClaudeCodeExtension } = await import('../src/index.js'));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('pty.node') || msg.includes('node-pty')) {
        console.error(
          'node-pty native module is not built for this platform.\n' +
            'Rebuild with: cd node_modules/node-pty && npx node-gyp rebuild\n' +
            'Or reinstall:  pnpm install'
        );
        process.exit(1);
      }
      throw error;
    }

    // Create extension with no settings (disables plugins, MCP, slash commands)
    const ext = createClaudeCodeExtension();

    // Hoist extension functions with namespace
    const { functions, dispose } = hoistExtension('claude_code', ext);

    // Create runtime context
    const ctx = createRuntimeContext({
      functions,
      callbacks: {
        onLog: (value) => console.log(formatOutput(value)),
      },
    });

    // Parse source
    const ast = parse(source);

    // Show what we're running
    const preview = source.length > 80 ? source.slice(0, 80) + '...' : source;
    console.error(`[test-host] Running: ${preview.replace(/\n/g, ' ')}`);
    console.error('[test-host] Waiting for Claude...');

    // Execute script
    const startTime = Date.now();
    const result = await execute(ast, ctx);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[test-host] Done in ${elapsed}s`);

    // Print result to stderr (stdout reserved for log output)
    console.error(`[test-host] Result: ${formatOutput(result.value)}`);

    // Cleanup
    dispose?.();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
