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
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';
import type { RillValue, ExecutionResult } from '@rcrsr/rill';
import {
  formatOutput,
  formatError,
  determineExitCode,
  VERSION,
} from './cli-shared.js';
import { loadModule } from './cli-module-loader.js';
import { explainError } from './cli-explain.js';

/**
 * Parsed command-line arguments
 */
export type ParsedArgs =
  | {
      mode: 'exec';
      file: string;
      args: string[];
      format: 'human' | 'json' | 'compact';
      verbose: boolean;
      maxStackDepth: number;
    }
  | { mode: 'eval'; expression: string }
  | { mode: 'help' | 'version' }
  | { mode: 'explain'; errorId: string };

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

  // Check for --explain flag (IC-11)
  const explainIndex = argv.findIndex((arg) => arg === '--explain');
  if (explainIndex !== -1) {
    const errorId = argv[explainIndex + 1];
    if (!errorId) {
      throw new Error('Missing error ID after --explain');
    }
    return { mode: 'explain', errorId };
  }

  // Parse format, verbose, and max-stack-depth flags (IC-11)
  let format: 'human' | 'json' | 'compact' = 'human';
  let verbose = false;
  let maxStackDepth = 10;

  const formatIndex = argv.findIndex((arg) => arg === '--format');
  if (formatIndex !== -1) {
    const formatValue = argv[formatIndex + 1];
    // AC-15: Unknown --format value
    if (
      formatValue !== 'human' &&
      formatValue !== 'json' &&
      formatValue !== 'compact'
    ) {
      throw new Error(
        `Invalid --format value: ${formatValue}. Must be one of: human, json, compact`
      );
    }
    format = formatValue;
  }

  if (argv.includes('--verbose')) {
    verbose = true;
  }

  const maxStackDepthIndex = argv.findIndex(
    (arg) => arg === '--max-stack-depth'
  );
  if (maxStackDepthIndex !== -1) {
    const depthValue = argv[maxStackDepthIndex + 1];
    if (!depthValue) {
      throw new Error('Missing value after --max-stack-depth');
    }
    const depth = parseInt(depthValue, 10);
    if (isNaN(depth) || depth < 1 || depth > 100) {
      throw new Error('--max-stack-depth must be a number between 1 and 100');
    }
    maxStackDepth = depth;
  }

  // Check for unknown flags
  const knownFlags = [
    '--help',
    '-h',
    '--version',
    '-v',
    '--explain',
    '--format',
    '--verbose',
    '--max-stack-depth',
  ];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && arg.startsWith('--')) {
      if (!knownFlags.includes(arg)) {
        throw new Error(`Unknown option: ${arg}`);
      }
      // Skip next argument if this is a flag that takes a value
      if (
        arg === '--format' ||
        arg === '--max-stack-depth' ||
        arg === '--explain'
      ) {
        i++;
      }
    } else if (arg && arg.startsWith('-') && arg !== '-') {
      if (!knownFlags.includes(arg)) {
        throw new Error(`Unknown option: ${arg}`);
      }
    }
  }

  // Determine mode from first positional argument (skip flags and their values)
  let firstArg: string | undefined;
  const positionalArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    // Skip flags
    if (knownFlags.includes(arg)) {
      // Skip the flag's value if it takes one
      if (
        arg === '--format' ||
        arg === '--max-stack-depth' ||
        arg === '--explain'
      ) {
        i++;
      }
      continue;
    }

    // This is a positional argument
    if (!firstArg) {
      firstArg = arg;
    }
    positionalArgs.push(arg);
  }

  if (!firstArg) {
    throw new Error('Missing file argument');
  }

  // Eval mode is not supported in rill-exec (only rill-eval)
  // This function is shared but context determines valid modes
  if (firstArg === '-e') {
    if (positionalArgs.length < 2) {
      throw new Error('Missing expression after -e');
    }
    return { mode: 'eval', expression: positionalArgs[1]! };
  }

  // Exec mode (file or stdin)
  const file = firstArg;
  const args = positionalArgs.slice(1);
  return { mode: 'exec', file, args, format, verbose, maxStackDepth };
}

/**
 * Execute a Rill script file with arguments and module support
 *
 * @param file - File path or '-' for stdin
 * @param args - Command-line arguments to pass as $ pipe value
 * @param options - Execution options
 * @returns Execution result with value, variables, and source text
 * @throws Error if file not found or execution fails
 */
export async function executeScript(
  file: string,
  args: string[],
  options?: { stdin?: boolean }
): Promise<ExecutionResult & { source: string }> {
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

  // Execute the script and return with source
  const result = await execute(ast, ctx);
  return { ...result, source };
}

/**
 * Entry point for rill-exec and rill-eval binaries
 *
 * Parses command-line arguments, executes scripts, and handles errors.
 * Writes results to stdout and errors to stderr.
 * Sets process.exit(1) on any error.
 */
export async function main(): Promise<void> {
  let source: string | undefined;
  let formatOptions:
    | {
        format: 'human' | 'json' | 'compact';
        verbose: boolean;
        maxStackDepth: number;
      }
    | undefined;

  try {
    const parsed = parseArgs(process.argv.slice(2));

    switch (parsed.mode) {
      case 'help':
        console.log(`Usage:
  rill-exec <script.rill> [args...]  Execute a Rill script file
  rill-exec -                        Read script from stdin
  rill-exec --help                   Show this help message
  rill-exec --version                Show version information
  rill-exec --explain RILL-XXXX      Show error documentation

Options:
  --format <format>         Output format: human, json, compact (default: human)
  --verbose                 Include additional error details
  --max-stack-depth <n>     Maximum call stack depth to display (default: 10, range: 1-100)

Arguments:
  args are passed to the script as a list of strings in $ (pipe value)

Examples:
  rill-exec script.rill
  rill-exec script.rill arg1 arg2
  rill-exec --format json script.rill
  rill-exec --verbose --max-stack-depth 20 script.rill
  rill-exec --explain RILL-R009
  echo "log(\\"hello\\")" | rill-exec -`);
        return;

      case 'version': {
        console.log(VERSION);
        return;
      }

      case 'explain': {
        // AC-16: Handle --explain command
        const documentation = explainError(parsed.errorId);
        if (documentation === null) {
          // AC-16: Malformed errorId shows usage help
          console.error(`Invalid error ID: ${parsed.errorId}`);
          console.error(
            'Error ID must be in format RILL-{L|P|R|C}{3-digit}, e.g., RILL-R009'
          );
          process.exit(1);
          return;
        }
        console.log(documentation);
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
        // Store format options for error handling
        formatOptions = {
          format: parsed.format,
          verbose: parsed.verbose,
          maxStackDepth: parsed.maxStackDepth,
        };

        // Execute mode (executeScript reads source internally)
        const result = await executeScript(parsed.file, parsed.args);

        // Store source from result for error enrichment
        source = result.source;

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
      // IC-11: Pass source text and format options to formatError
      console.error(
        formatError(err, source, {
          format: formatOptions?.format ?? 'human',
          verbose: formatOptions?.verbose ?? false,
          includeCallStack: true,
          maxCallStackDepth: formatOptions?.maxStackDepth ?? 10,
        })
      );
    } else {
      console.error(
        formatError(new Error(String(err)), source, {
          format: formatOptions?.format ?? 'human',
          verbose: formatOptions?.verbose ?? false,
          includeCallStack: true,
          maxCallStackDepth: formatOptions?.maxStackDepth ?? 10,
        })
      );
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
