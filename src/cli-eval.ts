#!/usr/bin/env node
/**
 * Rill CLI - Evaluate rill expressions
 *
 * Usage:
 *   rill-eval '"hello".len'
 *   rill-eval --help
 *   rill-eval --version
 */

import {
  createRuntimeContext,
  execute,
  parse,
  type ExecutionResult,
} from './index.js';
import { formatOutput, determineExitCode, VERSION } from './cli-shared.js';

/**
 * Parse command-line arguments into structured command
 */
function parseArgs(
  argv: string[]
):
  | { mode: 'exec'; file: string; args: string[] }
  | { mode: 'eval'; expression: string }
  | { mode: 'help' | 'version' } {
  // Check for --help and --version in any position
  if (argv.includes('--help')) {
    return { mode: 'help' };
  }
  if (argv.includes('--version')) {
    return { mode: 'version' };
  }

  // Check for unknown flags (anything starting with -)
  for (const arg of argv) {
    if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  // If no arguments, default to help
  if (argv.length === 0) {
    return { mode: 'help' };
  }

  // First positional arg determines mode
  const firstArg = argv[0]!;

  // Eval mode: direct expression
  return { mode: 'eval', expression: firstArg };
}

/**
 * Evaluate a Rill expression without file context
 */
export async function evaluateExpression(
  expression: string
): Promise<ExecutionResult> {
  const ctx = createRuntimeContext({
    callbacks: {
      onLog: (value) => console.log(formatOutput(value)),
    },
  });

  // Set pipeValue to empty list (Rill has no null concept per language spec)
  ctx.pipeValue = [];

  const ast = parse(expression);
  return execute(ast, ctx);
}

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`Rill Expression Evaluator

Usage:
  rill-eval <expression>      Evaluate a Rill expression
  rill-eval --help            Show this help message
  rill-eval --version         Show version information

Examples:
  rill-eval '"hello".len'
  rill-eval '5 + 3'
  rill-eval '[1, 2, 3] -> map |x|($x * 2)'`);
}

/**
 * Display version information
 */
function showVersion(): void {
  console.log(`rill-eval ${VERSION}`);
}

/**
 * Entry point for rill-eval binary
 */
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    const command = parseArgs(args);

    if (command.mode === 'help') {
      showHelp();
      return;
    }

    if (command.mode === 'version') {
      showVersion();
      return;
    }

    if (command.mode === 'eval') {
      const result = await evaluateExpression(command.expression);
      const { code, message } = determineExitCode(result.value);

      if (message !== undefined) {
        console.log(message);
      } else {
        console.log(formatOutput(result.value));
      }
      process.exit(code);
    }

    // Unreachable - exec mode not supported in rill-eval
    console.error('Unexpected command mode');
    process.exit(1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Only run main if this is the entry point (not imported)
const shouldRunMain =
  process.env['NODE_ENV'] !== 'test' &&
  !process.env['VITEST'] &&
  !process.env['VITEST_WORKER_ID'];

if (shouldRunMain) {
  main();
}
