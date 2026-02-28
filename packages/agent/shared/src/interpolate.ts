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
