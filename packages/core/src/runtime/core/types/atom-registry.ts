/**
 * Atom registry for interned error-code identifiers.
 *
 * RillCode is an opaque, identity-compared atom authored in scripts as
 * `#NAME`. The registry maps a normalized uppercase name to a single
 * frozen RillCode instance; every resolution of that name returns the
 * same reference. Unknown names resolve to the pre-registered `#R001`
 * fallback instead of throwing.
 *
 * Core pre-registers 11 generic atoms at module load, before any script
 * parses. Extensions register additional atoms via
 * `registerErrorCode(name, kind)` at factory init time. Double
 * registration with a different kind is a hard failure.
 */

// ============================================================
// VALIDATION
// ============================================================

/** Uppercase atom name regex: `[A-Z][A-Z0-9_]*`. Max 64 characters. */
const ATOM_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

/** Maximum permitted atom name length (AC-B7). */
const MAX_ATOM_NAME_LENGTH = 64;

// ============================================================
// TYPES
// ============================================================

/**
 * Opaque, interned error-code atom.
 *
 * Produced exclusively by the registry. Compared by identity
 * (`a === b`), never by string equality. `name` carries the bare
 * uppercase form without the `#` sigil. `kind` is a free-form
 * classification tag supplied at registration time.
 */
export interface RillCode {
  readonly __rill_atom: true;
  readonly name: string;
  readonly kind: string;
}

// ============================================================
// REGISTRY STATE
// ============================================================

const registry = new Map<string, RillCode>();

/**
 * Internal constructor. Not exported: raw construction outside the
 * registry is forbidden.
 */
function makeAtom(name: string, kind: string): RillCode {
  return Object.freeze({
    __rill_atom: true as const,
    name,
    kind,
  });
}

/**
 * Validates an atom name against the uppercase regex and length limit.
 * Throws on failure (EC-2 / AC-B7).
 */
function validateAtomName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Atom name must be a non-empty string, got ${typeof name}`);
  }
  if (name.length > MAX_ATOM_NAME_LENGTH) {
    throw new Error(
      `Atom name '${name}' exceeds ${MAX_ATOM_NAME_LENGTH}-character limit`
    );
  }
  if (!ATOM_NAME_REGEX.test(name)) {
    throw new Error(
      `Atom name '${name}' does not match uppercase pattern [A-Z][A-Z0-9_]*`
    );
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Interns and registers an error-code atom.
 *
 * Called once per name at factory init time; core pre-registers its
 * set at module load. Idempotent for identical (name, kind); re-registering
 * the same name with a different kind throws.
 *
 * @throws Error when `name` fails the uppercase regex or exceeds 64 chars (EC-2).
 * @throws Error when `name` was previously registered with a different kind (EC-1).
 */
export function registerErrorCode(name: string, kind: string): RillCode {
  validateAtomName(name);
  return registerAtomInternal(name, kind);
}

/**
 * Internal registration used by core bootstrap only.
 *
 * Skips regex validation so the reserved sentinel `ok` (authored as
 * `#ok` in scripts) can be pre-registered despite its lowercase form.
 * All other atoms still flow through `validateAtomName`.
 */
function registerAtomInternal(name: string, kind: string): RillCode {
  const existing = registry.get(name);
  if (existing !== undefined) {
    if (existing.kind !== kind) {
      throw new Error(
        `Atom '#${name}' already registered with kind '${existing.kind}', cannot re-register as '${kind}'`
      );
    }
    return existing;
  }
  const atom = makeAtom(name, kind);
  registry.set(name, atom);
  return atom;
}

/**
 * Resolves a name to its interned atom, or `#R001` when unregistered.
 *
 * Never throws (EC-3). Used by parse/link-time atom resolution and by
 * the `:code(name)` conversion.
 */
export function resolveAtom(name: string): RillCode {
  const found = registry.get(name);
  if (found !== undefined) return found;
  // EC-3: unregistered -> fallback. `#R001` is pre-registered below
  // before this function can be called from user code.
  const fallback = registry.get('R001');
  if (fallback === undefined) {
    // Bootstrap guard: should never occur after module load.
    throw new Error(
      'Atom registry bootstrap invariant violated: #R001 not pre-registered'
    );
  }
  return fallback;
}

/**
 * Returns the bare name of an atom (no `#` sigil).
 *
 * Backs the `-> name` conversion on `:code` values.
 */
export function atomName(code: RillCode): string {
  return code.name;
}

// ============================================================
// PRE-REGISTERED CORE ATOMS
// ============================================================

/**
 * Core pre-registers 11 generic atoms at module load.
 *
 * Order matters: `#ok` and `#R001` register first so that
 * - valid-status singletons can reference `#ok`, and
 * - `resolveAtom` fallback (`#R001`) is available before any other
 *   resolve call.
 *
 * `#R004` is explicitly NOT pre-registered.
 */
const CORE_ATOM_REGISTRATIONS: ReadonlyArray<readonly [string, string]> = [
  // Bootstrap-critical atoms first.
  ['ok', 'status'],
  ['R001', 'registry'],
  // Remaining generic atoms.
  ['TIMEOUT', 'generic'],
  ['AUTH', 'generic'],
  ['RATE_LIMIT', 'generic'],
  ['UNAVAILABLE', 'generic'],
  ['NOT_FOUND', 'generic'],
  ['CONFLICT', 'generic'],
  ['INVALID_INPUT', 'generic'],
  ['DISPOSED', 'generic'],
  ['R999', 'registry'],
  // FR-ERR-17 taxonomy: typed atom for type-assertion / conversion
  // failures. Registered here so mixins and type-layer helpers can
  // resolve `#TYPE_MISMATCH` before any script parses.
  ['TYPE_MISMATCH', 'generic'],
];

for (const [name, kind] of CORE_ATOM_REGISTRATIONS) {
  // Bootstrap path bypasses regex validation so reserved sentinel
  // `ok` (lowercase, `#ok` in script form) can register alongside the
  // uppercase generics.
  registerAtomInternal(name, kind);
}

// ============================================================
// INTERNAL HELPERS (exported for status module use)
// ============================================================

/**
 * Returns the pre-registered `#ok` atom.
 *
 * Used by status.ts to build the frozen empty-status singleton without
 * a runtime `resolveAtom` call on every access.
 */
export function okAtom(): RillCode {
  const ok = registry.get('ok');
  if (ok === undefined) {
    throw new Error(
      'Atom registry bootstrap invariant violated: #ok not pre-registered'
    );
  }
  return ok;
}
