/**
 * Proxy-side NDJSON parsing utilities.
 * Used by process-manager to parse child stdout messages.
 *
 * IC-38: parseChildLine, writeJsonLine
 */

import type { Writable } from 'node:stream';
import type { StdioRunResult, StdioAhiRequest } from '@rcrsr/rill-agent-shared';

// ============================================================
// PARSING
// ============================================================

/**
 * Parse a single line from child stdout.
 *
 * Returns StdioRunResult when method is 'run.result'.
 * Returns StdioAhiRequest when method is 'ahi'.
 * Returns null for non-JSON lines (AC-64), unknown methods, or parse errors
 * on lines that do not look like JSON objects.
 *
 * EC-14: Lines that start with '{' but fail JSON.parse are protocol errors —
 * the caller is responsible for rejecting in that case via the returned null
 * combined with the startsWith('{') check in process-manager.
 */
export function parseChildLine(
  line: string
): StdioRunResult | StdioAhiRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const method = obj['method'];

  if (method === 'run.result') {
    return parsed as StdioRunResult;
  }

  if (method === 'ahi') {
    return parsed as StdioAhiRequest;
  }

  return null;
}

// ============================================================
// WRITING
// ============================================================

/**
 * Serialize value to JSON and write it to the stream followed by '\n'.
 */
export function writeJsonLine(stream: Writable, value: unknown): void {
  stream.write(JSON.stringify(value) + '\n');
}
