import { readFileSync } from 'node:fs';
import { interpolateConfigDeep } from '@rcrsr/rill-agent-shared';

/**
 * Load and interpolate agent config from a file path or inline JSON string.
 *
 * File path detection: value contains '/' or '\', or ends with '.json'.
 * Inline JSON: any other value is parsed directly as JSON.
 *
 * EC-6: throws with readable path error if the file is not found.
 * EC-7: throws with parse error if JSON is invalid.
 */
export function loadConfig(
  value: string
): Record<string, Record<string, unknown>> {
  const isPath =
    value.includes('/') || value.includes('\\') || value.endsWith('.json');

  const raw = isPath ? readFileSync(value, 'utf-8') : value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config: ${msg}`, { cause: err });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Config must be a JSON object, got: ${JSON.stringify(parsed)}`
    );
  }

  return interpolateConfigDeep(
    parsed as Record<string, Record<string, unknown>>,
    process.env
  );
}
