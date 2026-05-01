import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';
/**
 * Atom registry for interned error-code identifiers.
 *
 * RillAtom is an opaque, identity-compared atom authored in scripts as
 * `#NAME`. The registry maps a normalized uppercase name to a single
 * frozen RillAtom instance; every resolution of that name returns the
 * same reference. Unknown names resolve to the pre-registered `#R001`
 * fallback instead of throwing.
 *
 * Core pre-registers a fixed set of atoms at module load, before any
 * script parses. The set covers four kinds:
 *  - `status` — the `#ok` sentinel (1)
 *  - `registry` — atom-registry fallbacks `#R001` and `#R999` (2)
 *  - `generic` — host-extension taxonomy (12: `#TIMEOUT`, `#AUTH`,
 *    `#FORBIDDEN`, `#RATE_LIMIT`, `#QUOTA_EXCEEDED`, `#UNAVAILABLE`,
 *    `#NOT_FOUND`, `#CONFLICT`, `#INVALID_INPUT`, `#PROTOCOL`,
 *    `#DISPOSED`, `#TYPE_MISMATCH`)
 *  - `runtime` — internal halt-builder atoms paired with `RILL-Rxxx`
 *    error IDs (a fixed list maintained alongside error-registry.ts)
 *
 * Extensions register additional atoms via
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
export interface RillAtom {
  readonly __rill_atom: true;
  readonly name: string;
  readonly kind: string;
}

// ============================================================
// REGISTRY STATE
// ============================================================

const registry = new Map<string, RillAtom>();

/**
 * Internal constructor. Not exported: raw construction outside the
 * registry is forbidden.
 */
function makeAtom(name: string, kind: string): RillAtom {
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
export function registerErrorCode(name: string, kind: string): RillAtom {
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
function registerAtomInternal(name: string, kind: string): RillAtom {
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
 * the `:atom(name)` conversion.
 */
export function resolveAtom(name: string): RillAtom {
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
 * Backs the `-> name` conversion on `:atom` values.
 */
export function atomName(atom: RillAtom): string {
  return atom.name;
}

// ============================================================
// PRE-REGISTERED CORE ATOMS
// ============================================================

/**
 * Pre-registration list executed at module load.
 *
 * Composition: 1 `status` (`#ok`), 2 `registry` (`#R001`, `#R999`),
 * 12 `generic` host-extension taxonomy atoms, and one `runtime` atom
 * per `RILL-Rxxx` halt-builder paired below. See module header for the
 * full generic list.
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
  ['FORBIDDEN', 'generic'],
  ['RATE_LIMIT', 'generic'],
  ['QUOTA_EXCEEDED', 'generic'],
  ['UNAVAILABLE', 'generic'],
  ['NOT_FOUND', 'generic'],
  ['CONFLICT', 'generic'],
  ['INVALID_INPUT', 'generic'],
  ['PROTOCOL', 'generic'],
  ['DISPOSED', 'generic'],
  // `pass<on_error: #IGNORE>` body form: option value used to opt into
  // catchable-halt suppression. Pre-registered so the option literal does
  // not collapse to the `#R001` fallback.
  ['IGNORE', 'generic'],
  ['R999', 'registry'],
  // FR-ERR-17 taxonomy: typed atom for type-assertion / conversion
  // failures. Registered here so mixins and type-layer helpers can
  // resolve `#TYPE_MISMATCH` before any script parses.
  ['TYPE_MISMATCH', 'generic'],
  // IR-3: error-wrap halt atom. Underscore form required by
  // ATOM_NAME_REGEX. Host-facing error ID `RILL-R015`/`RILL-R016`
  // (hyphen form) is a separate string namespace in error-registry.ts.
  [ERROR_ATOMS[ERROR_IDS.RILL_R016], 'runtime'],
  // IC-4: collections.ts halt-builder migration atoms. Underscore form
  // per ATOM_NAME_REGEX. Host-facing IDs use hyphen form (RILL-Rxxx).
  [ERROR_ATOMS[ERROR_IDS.RILL_R002], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R003], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R010], 'runtime'],
  // Evaluator-mixin migration: type-conversion and list-dispatch atoms.
  [ERROR_ATOMS[ERROR_IDS.RILL_R036], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R037], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R038], 'runtime'],
  // builtins.ts collection-operator atoms.
  [ERROR_ATOMS[ERROR_IDS.RILL_R040], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R041], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R042], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R044], 'runtime'],
  // use.ts resolver atoms.
  [ERROR_ATOMS[ERROR_IDS.RILL_R054], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R055], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R056], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R057], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R058], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R061], 'runtime'],
  // timeout<total:> and timeout<idle:> halt atoms.
  [ERROR_ATOMS[ERROR_IDS.RILL_R082], 'runtime'],
  [ERROR_ATOMS[ERROR_IDS.RILL_R083], 'runtime'],
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
export function okAtom(): RillAtom {
  const ok = registry.get('ok');
  if (ok === undefined) {
    throw new Error(
      'Atom registry bootstrap invariant violated: #ok not pre-registered'
    );
  }
  return ok;
}
