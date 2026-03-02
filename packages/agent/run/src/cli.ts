#!/usr/bin/env node
import { executeAgent, type LogLevel } from './executor.js';
import { loadBundle } from './loader.js';
import { loadConfig } from './load-config.js';

// ============================================================
// ARG PARSING HELPERS
// ============================================================

/**
 * Parse --param key=value flags from an argv array.
 * Each flag produces one entry in the returned record.
 * Values are always strings; the key splits on the first '='.
 */
function parseParams(args: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--param' && i + 1 < args.length) {
      const raw = args[i + 1]!;
      const eqIdx = raw.indexOf('=');
      if (eqIdx !== -1) {
        const key = raw.slice(0, eqIdx);
        const value = raw.slice(eqIdx + 1);
        params[key] = value;
      }
      i += 1;
    }
  }
  return params;
}

/**
 * Extract a named flag value from an argv array.
 * Returns the value following --flag, or undefined if absent.
 */
function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

/**
 * Read all data from stdin as a string.
 * Returns empty string if stdin has no data.
 */
async function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () =>
      resolve(Buffer.concat(chunks).toString('utf-8'))
    );
    process.stdin.on('error', reject);
  });
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Extract positional args (args that are not flags or flag values)
  const flagsWithValues = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (
      (arg === '--param' ||
        arg === '--timeout' ||
        arg === '--config' ||
        arg === '--log-level') &&
      i + 1 < args.length
    ) {
      flagsWithValues.add(i);
      flagsWithValues.add(i + 1);
      i += 1;
    }
  }
  const positionals = args.filter(
    (_, i) => !flagsWithValues.has(i) && !args[i]!.startsWith('-')
  );

  const bundleDir = positionals[0];
  const agentName = positionals[1];

  // bundle-dir is required
  if (bundleDir === undefined || bundleDir === '') {
    process.stderr.write(
      'Error: bundle-dir is required\nUsage: rill-agent-run <bundle-dir> [agent-name] [--param key=value]... [--timeout <ms>] [--config <path|json>] [--log-level silent|info|debug]\n'
    );
    process.exit(1);
  }

  // Parse --timeout flag
  let timeout: number | undefined;
  const timeoutStr = parseFlag(args, '--timeout');
  if (timeoutStr !== undefined) {
    const parsed = parseInt(timeoutStr, 10);
    if (!isNaN(parsed)) {
      timeout = parsed;
    }
  }

  // Parse --config flag: file path or inline JSON, interpolated against process.env
  let config: Record<string, Record<string, unknown>> | undefined;
  const configStr = parseFlag(args, '--config');
  if (configStr !== undefined) {
    try {
      config = loadConfig(configStr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(1);
    }
  }

  // Parse log level: --log-level flag overrides LOG_LEVEL env var
  const logLevelStr =
    parseFlag(args, '--log-level') ?? process.env['LOG_LEVEL'] ?? 'info';
  const logLevel: LogLevel = (
    ['silent', 'info', 'debug'] as LogLevel[]
  ).includes(logLevelStr as LogLevel)
    ? (logLevelStr as LogLevel)
    : 'info';

  // Build params: start from stdin if piped, then overlay --param flags
  let baseParams: Record<string, unknown> = {};

  if (!process.stdin.isTTY) {
    const raw = await readStdin();
    if (raw.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          baseParams = parsed as Record<string, unknown>;
        } else {
          // AC-53: invalid stdin JSON structure
          process.stderr.write(
            `Error: stdin JSON must be an object, got: ${JSON.stringify(parsed)}\n`
          );
          process.exit(1);
        }
      } catch (err) {
        // AC-53: stdin parse error
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: failed to parse stdin as JSON: ${msg}\n`);
        process.exit(1);
      }
    }
  }

  // AC-57: --param flags override stdin keys
  const flagParams = parseParams(args);
  const params: Record<string, unknown> = { ...baseParams, ...flagParams };

  try {
    const { handler, agentName: resolvedName } = await loadBundle(
      bundleDir,
      agentName !== undefined && agentName !== '' ? agentName : undefined
    );

    const { result } = await executeAgent(handler, params, {
      timeout,
      agentName: resolvedName,
      config,
      logLevel,
    });

    // AC-42, AC-56: write JSON-encoded result to stdout
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    // AC-46: write error to stderr, exit 1
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
