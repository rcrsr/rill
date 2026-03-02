export interface InterpolationResult {
  /** The interpolated string value. */
  readonly value: string;
  /** Variable names that could not be resolved. */
  readonly unresolved: readonly string[];
}

/**
 * Interpolates `${IDENTIFIER}` placeholders in a string using the provided env map.
 *
 * IDENTIFIER must match `[A-Z_][A-Z0-9_]*`. Lowercase or mixed-case names are
 * treated as literals and left unchanged.
 *
 * Unresolved variables remain as `${VAR}` in the output and appear in the
 * returned `unresolved` array. Empty string is a valid resolved value.
 *
 * DEVIATION: The spec declares the return type as `string`, but this
 * implementation returns `InterpolationResult` (matching the compose package
 * pattern in compose/src/interpolate.ts) to surface unresolved variable names
 * to callers without a second pass.
 */
export function interpolateEnv(
  value: string,
  env: Record<string, string | undefined>
): InterpolationResult {
  const unresolved: string[] = [];
  const PATTERN = /(?<!\$\{)\$\{([A-Z_][A-Z0-9_]*)\}/g;

  const result = value.replace(PATTERN, (_match, name: string) => {
    if (
      Object.prototype.hasOwnProperty.call(env, name) &&
      env[name] !== undefined
    ) {
      return env[name];
    }
    unresolved.push(name);
    return `\${${name}}`;
  });

  return { value: result, unresolved };
}

/**
 * Walks a nested config object and interpolates `${VAR}` patterns in every
 * string value using `interpolateEnv`.
 *
 * Non-string values are passed through unchanged. Unset variables retain their
 * literal `${VAR}` pattern in the output (matching `interpolateEnv` behavior).
 *
 * Returns a new object; the original config is not mutated.
 */
export function interpolateConfigDeep(
  config: Record<string, Record<string, unknown>>,
  env: Record<string, string | undefined>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const section of Object.keys(config)) {
    const inner = config[section] ?? {};
    const interpolated: Record<string, unknown> = {};
    for (const key of Object.keys(inner)) {
      const val = inner[key];
      interpolated[key] =
        typeof val === 'string' ? interpolateEnv(val, env).value : val;
    }
    result[section] = interpolated;
  }
  return result;
}
