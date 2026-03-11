import type { RillConfigFile } from './types.js';
import {
  ConfigParseError,
  ConfigEnvError,
  ConfigValidationError,
} from './errors.js';

const ENV_VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function interpolateString(
  value: string,
  env: Record<string, string>,
  missing: Set<string>
): string {
  return value.replace(ENV_VAR_PATTERN, (_match, name: string) => {
    if (name in env) {
      return env[name] as string;
    }
    missing.add(name);
    return _match;
  });
}

function interpolateValue(
  value: unknown,
  env: Record<string, string>,
  missing: Set<string>
): unknown {
  if (typeof value === 'string') {
    return interpolateString(value, env, missing);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, env, missing));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = interpolateValue(
        (value as Record<string, unknown>)[key],
        env,
        missing
      );
    }
    return result;
  }
  return value;
}

function assertOptionalString(field: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new ConfigValidationError(
      `Field ${field}: expected string, got ${typeof value}`
    );
  }
}

function assertOptionalObject(field: string, value: unknown): void {
  if (
    value !== undefined &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  ) {
    throw new ConfigValidationError(
      `Field ${field}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`
    );
  }
}

export function parseConfig(
  raw: string,
  env: Record<string, string>
): RillConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ConfigParseError(`Failed to parse config: ${reason}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigParseError(
      `Failed to parse config: expected a JSON object`
    );
  }

  const obj = parsed as Record<string, unknown>;

  assertOptionalString('name', obj['name']);
  assertOptionalString('version', obj['version']);
  assertOptionalString('description', obj['description']);
  assertOptionalString('runtime', obj['runtime']);
  assertOptionalString('main', obj['main']);
  assertOptionalObject('extensions', obj['extensions']);
  assertOptionalObject('context', obj['context']);
  assertOptionalObject('host', obj['host']);
  assertOptionalObject('modules', obj['modules']);

  const missing = new Set<string>();
  const interpolated = interpolateValue(obj, env, missing) as Record<
    string,
    unknown
  >;

  if (missing.size > 0) {
    const names = [...missing].sort().join(', ');
    throw new ConfigEnvError(`Missing environment variables: ${names}`);
  }

  return interpolated as unknown as RillConfigFile;
}
