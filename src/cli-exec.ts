#!/usr/bin/env node
/**
 * CLI Execution Entry Point
 *
 * Implements main(), parseArgs(), and executeScript() for rill-exec and rill-eval binaries.
 * Handles file execution, stdin input, and module loading.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { parse, execute, createRuntimeContext } from './index.js';
import type { RillValue, ExecutionResult } from './index.js';
import { formatOutput, formatError, determineExitCode } from './cli-shared.js';
import { loadModule } from './cli-module-loader.js';

/**
 * Parsed command-line arguments
 */
export type ParsedArgs =
  | { mode: 'exec'; file: string; args: string[] }
  | { mode: 'eval'; expression: string }
  | { mode: 'help' | 'version' };

/**
 * Parse command-line arguments into structured command
 *
 * @param argv - Raw command-line arguments (typically process.argv.slice(2))
 * @returns Parsed command object
 */
export function parseArgs(argv: string[]): ParsedArgs {
  // Check for --help or --version flags in any position
  if (argv.includes('--help') || argv.includes('-h')) {
    return { mode: 'help' };
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    return { mode: 'version' };
  }

  // Check for unknown flags
  for (const arg of argv) {
    if (arg.startsWith('--') && arg !== '--help' && arg !== '--version') {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (arg.startsWith('-') && arg !== '-' && arg !== '-h' && arg !== '-v') {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  // Determine mode from first positional argument
  const firstArg = argv[0];

  if (!firstArg) {
    throw new Error('Missing file argument');
  }

  // Eval mode is not supported in rill-exec (only rill-eval)
  // This function is shared but context determines valid modes
  if (firstArg === '-e') {
    if (!argv[1]) {
      throw new Error('Missing expression after -e');
    }
    return { mode: 'eval', expression: argv[1] };
  }

  // Exec mode (file or stdin)
  const file = firstArg;
  const args = argv.slice(1);
  return { mode: 'exec', file, args };
}

/**
 * Execute a Rill script file with arguments and module support
 *
 * @param file - File path or '-' for stdin
 * @param args - Command-line arguments to pass as $ pipe value
 * @param options - Execution options
 * @returns Execution result with value and variables
 * @throws Error if file not found or execution fails
 */
export async function executeScript(
  file: string,
  args: string[],
  options?: { stdin?: boolean }
): Promise<ExecutionResult> {
  // Read source from file or stdin
  let source: string;
  let scriptPath: string;

  if (file === '-' || options?.stdin) {
    // Read from stdin (must use sync API for stdin)
    source = fsSync.readFileSync(0, 'utf-8');
    scriptPath = path.resolve(process.cwd(), '<stdin>');
  } else {
    // Check if file exists
    try {
      await fs.access(file);
    } catch {
      throw new Error(`File not found: ${file}`);
    }

    // Read from file
    source = await fs.readFile(file, 'utf-8');
    scriptPath = path.resolve(file);
  }

  // Parse the script
  const ast = parse(source);

  // Extract frontmatter for use: declarations
  const frontmatter: Record<string, unknown> = ast.frontmatter
    ? ((yaml.parse(ast.frontmatter.content) as Record<
        string,
        unknown
      > | null) ?? {})
    : {};

  // Load modules if use: declarations exist
  const variables: Record<string, RillValue> = {};
  if (frontmatter['use'] && Array.isArray(frontmatter['use'])) {
    const cache = new Map<string, Record<string, RillValue>>();
    for (const entry of frontmatter['use']) {
      if (typeof entry === 'object' && entry !== null) {
        const [name, modulePath] = Object.entries(entry)[0] as [string, string];
        variables[name] = await loadModule(modulePath, scriptPath, cache);
      }
    }
  }

  // Create runtime context with modules
  const ctx = createRuntimeContext({
    variables,
    callbacks: {
      onLog: (value) => console.log(formatOutput(value)),
    },
  });

  // Set pipe value to arguments (string array)
  ctx.pipeValue = args;

  // Execute the script
  return await execute(ast, ctx);
}

/**
 * Entry point for rill-exec and rill-eval binaries
 *
 * Parses command-line arguments, executes scripts, and handles errors.
 * Writes results to stdout and errors to stderr.
 * Sets process.exit(1) on any error.
 */
export async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2));

    switch (parsed.mode) {
      case 'help':
        console.log(`Usage:
  rill-exec <script.rill> [args...]  Execute a Rill script file
  rill-exec -                        Read script from stdin
  rill-exec --help                   Show this help message
  rill-exec --version                Show version information

Arguments:
  args are passed to the script as a list of strings in $ (pipe value)

Examples:
  rill-exec script.rill
  rill-exec script.rill arg1 arg2
  echo "log(\\"hello\\")" | rill-exec -`);
        return;

      case 'version': {
        // Read version from package.json
        const packageJsonPath = path.resolve(
          path.dirname(new URL(import.meta.url).pathname),
          '../package.json'
        );
        try {
          const packageJson = JSON.parse(
            await fs.readFile(packageJsonPath, 'utf-8')
          );
          console.log(packageJson.version);
        } catch {
          console.log('0.1.0'); // Fallback version
        }
        return;
      }

      case 'eval':
        // This shouldn't happen in rill-exec, but handle it anyway
        console.error(
          'Eval mode not supported in rill-exec. Use rill-eval instead.'
        );
        process.exit(1);
        return;

      case 'exec': {
        // Execute mode
        const result = await executeScript(parsed.file, parsed.args);
        const { code, message } = determineExitCode(result.value);

        // Output message if present, otherwise output the result value
        if (message !== undefined) {
          console.log(message);
        } else {
          console.log(formatOutput(result.value));
        }

        // Exit with computed code
        process.exit(code);
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(formatError(err));
    } else {
      console.error(formatError(new Error(String(err))));
    }
    process.exit(1);
  }
}

// Only run main if not in test environment
const shouldRunMain =
  process.env['NODE_ENV'] !== 'test' &&
  !process.env['VITEST'] &&
  !process.env['VITEST_WORKER_ID'];

if (shouldRunMain) {
  main();
}
