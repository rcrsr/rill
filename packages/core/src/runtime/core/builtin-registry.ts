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
  toCallable,
  type ApplicationCallable,
  type RillFunction,
} from './callable.js';

// Parsed once at registration time, not per context creation.
const BUILTIN_FN_CACHE = new Map<string, ApplicationCallable>();
let registered = false;

/** Register the builtin function table. Called by `runtime/ext/builtins.ts` at module load. */
export function registerBuiltinFunctions(
  fns: Record<string, RillFunction>
): void {
  BUILTIN_FN_CACHE.clear();
  for (const [name, entry] of Object.entries(fns)) {
    BUILTIN_FN_CACHE.set(name, toCallable(entry));
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
