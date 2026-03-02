#!/usr/bin/env node
import { createProxy } from './proxy.js';
import { loadConfig } from './config.js';
import type { ProxyConfig, LogLevel } from './config.js';
import { DEFAULT_PORT, DEFAULT_CONCURRENCY } from './config.js';

// ============================================================
// ARG PARSING HELPERS
// ============================================================

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

// ============================================================
// ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --bundles is required
  const bundlesDir = parseFlag(args, '--bundles');
  if (bundlesDir === undefined || bundlesDir === '') {
    process.stderr.write(
      'Error: --bundles <dir> is required\n' +
        'Usage: rill-agent-proxy --bundles <dir> [--port <number>] [--config <path>]\n' +
        '                        [--max-concurrent <n>] [--max-per-agent <n>]\n' +
        '                        [--timeout <ms>] [--log-level <level>]\n'
    );
    process.exit(1);
  }

  // Parse --config flag: load base config from file, then merge CLI flags on top
  let config: ProxyConfig;
  const configPath = parseFlag(args, '--config');
  if (configPath !== undefined) {
    try {
      config = loadConfig(configPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(1);
    }
  } else {
    config = { bundlesDir };
  }

  // CLI flags take precedence over file config
  const portStr = parseFlag(args, '--port');
  const port =
    portStr !== undefined
      ? parseInt(portStr, 10)
      : (config.port ?? DEFAULT_PORT);

  const maxConcurrentStr = parseFlag(args, '--max-concurrent');
  const maxConcurrent =
    maxConcurrentStr !== undefined
      ? parseInt(maxConcurrentStr, 10)
      : (config.concurrency?.maxConcurrent ??
        DEFAULT_CONCURRENCY.maxConcurrent);

  const maxPerAgentStr = parseFlag(args, '--max-per-agent');
  const maxConcurrentPerAgent =
    maxPerAgentStr !== undefined
      ? parseInt(maxPerAgentStr, 10)
      : (config.concurrency?.maxConcurrentPerAgent ??
        DEFAULT_CONCURRENCY.maxConcurrentPerAgent);

  const timeoutStr = parseFlag(args, '--timeout');
  const requestTimeoutMs =
    timeoutStr !== undefined
      ? parseInt(timeoutStr, 10)
      : (config.concurrency?.requestTimeoutMs ??
        DEFAULT_CONCURRENCY.requestTimeoutMs);

  const logLevelStr = parseFlag(args, '--log-level');
  const logLevel: LogLevel | undefined =
    logLevelStr !== undefined ? (logLevelStr as LogLevel) : config.logLevel;

  // Build final merged config — CLI flags override file config
  const finalConfig: ProxyConfig = {
    ...config,
    bundlesDir,
    port,
    logLevel,
    concurrency: {
      maxConcurrent,
      maxConcurrentPerAgent,
      queueSize: config.concurrency?.queueSize ?? DEFAULT_CONCURRENCY.queueSize,
      requestTimeoutMs,
    },
  };

  let proxy: Awaited<ReturnType<typeof createProxy>>;
  try {
    proxy = await createProxy(finalConfig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  process.on('SIGTERM', () => {
    void proxy.close().then(() => {
      process.exit(0);
    });
  });

  try {
    await proxy.listen();
  } catch (err) {
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
