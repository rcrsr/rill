/**
 * Extension-Throw Tagging
 *
 * Tracks which thrown errors originated from extension-provided host
 * functions (the dispatch boundary in `invokeFnCallable`). The reshape
 * wrapper in `execute.ts` uses this tag to distinguish extension-boundary
 * throws (which reshape per AC-E4 / EC-6 into `#R999` / `#DISPOSED`
 * invalid values) from internal engine halts (which propagate).
 *
 * Implementation: a module-level {@link WeakSet} of error instances.
 * Errors added here at the `invokeFnCallable` catch site are then
 * checked by `reshapeUnhandledThrow` at the top of the stepper.
 *
 * Why WeakSet:
 * - Does not retain errors after collection (no memory leak).
 * - Primitive throws (string/number) cannot be added; they are
 *   handled separately as non-Error reshape targets.
 *
 * @internal
 */

const EXTENSION_THROWS = new WeakSet<object>();

/** Mark an error as originating from an extension dispatch boundary. */
export function markExtensionThrow(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    EXTENSION_THROWS.add(error);
  }
}

/** Whether an error was marked as originating from an extension dispatch. */
export function isExtensionThrow(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && EXTENSION_THROWS.has(error)
  );
}
