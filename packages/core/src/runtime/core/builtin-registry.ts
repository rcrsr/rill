/**
 * Builtin Function Registry
 *
 * Core-owned registration point for the builtin function table. The table
 * itself lives in `runtime/ext/builtins.ts`, which sits above core in the
 * layer order, so core cannot import it directly (enforced by the
 * `no-restricted-imports` layer rules in .oxlintrc.json). Instead, ext
 * registers its table here at module load, and core consumers
 * (`context.ts`, `introspection.ts`) read from this registry.
 *
 * Contract: the registered table is treated as frozen after registration.
 * Mutating it afterwards produces stale cache entries.
 */

import {
  callable,
  type ApplicationCallable,
  type RillFunction,
  type RillParam,
} from './callable.js';

// Parsed once at registration time, not per context creation.
const BUILTIN_FN_CACHE = new Map<string, ApplicationCallable>();
let registered = false;

/**
 * Register the builtin function table. Called by `runtime/ext/builtins.ts`
 * at module load. `untypedNames` lists builtins that are genuinely variadic
 * and must skip arg validation.
 */
export function registerBuiltinFunctions(
  fns: Record<string, RillFunction>,
  untypedNames: ReadonlySet<string>
): void {
  BUILTIN_FN_CACHE.clear();
  for (const [name, entry] of Object.entries(fns)) {
    const appCallable = callable(entry.fn, false);
    if (untypedNames.has(name)) {
      BUILTIN_FN_CACHE.set(name, appCallable);
      continue;
    }
    BUILTIN_FN_CACHE.set(name, {
      ...appCallable,
      params: entry.params as RillParam[],
      returnType: entry.returnType,
    });
  }
  registered = true;
}

function assertRegistered(): void {
  if (!registered) {
    throw new Error(
      'Builtin registry not initialized. Import the public entry point ' +
        '(src/index.ts) or runtime/ext/builtins.js before using the runtime.'
    );
  }
}

/** Builtin functions as pre-parsed callables, keyed by name. */
export function getBuiltinFunctionCache(): ReadonlyMap<
  string,
  ApplicationCallable
> {
  assertRegistered();
  return BUILTIN_FN_CACHE;
}

/** True when `name` is a registered builtin function. */
export function isBuiltinFunctionName(name: string): boolean {
  assertRegistered();
  return BUILTIN_FN_CACHE.has(name);
}
