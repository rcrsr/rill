/**
 * Control Statement Options
 *
 * One evaluator serves the options of every control statement: `guard`,
 * `retry`, `timeout`, `pass`, and the loop `do` (`while ... do` and
 * `do ... while`). The options are a dict written in parentheses after the
 * keyword, so they run once per statement run, before the body, and are
 * checked against the keyword's options type.
 *
 * - `guard`:   `on` (optional)
 * - `retry`:   `attempts` (required) and `on` (optional)
 * - `timeout`: `total` and `idle` (both optional)
 * - `pass`:    `ignore_halts` and `async` (bools, default `false`)
 * - `do`:      `limit` (optional)
 *
 * `on` is `union(error_code, list(error_code))`; a single atom is normalized
 * to a list. An empty list names no code and halts.
 *
 * Halts:
 * - an unknown, missing, or wrong-typed option halts `#TYPE_MISMATCH`
 * - an option given twice, by a spread or a computed key, halts
 *   `#INVALID_INPUT`, as does an empty computed `on` list
 * - a spread of a non-dict halts RILL-R002
 *
 * @internal
 */

import type { ASTNode, DictNode } from '../../../../types.js';
import type {
  RillDuration,
  RillValue,
  TypeStructure,
} from '../../types/structures.js';
import { formatValue, inferType } from '../../types/registrations.js';
import { formatStructure, structureMatches } from '../../types/operations.js';
import { isAtom, isDuration } from '../../types/guards.js';
import { ERROR_CODE_STRUCTURE } from '../../types/error-code.js';
import { throwCatchableHostHalt, throwTypeHalt } from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import type { EvalState } from '../state.js';
import { getNodeLocation, setDictField } from '../shared.js';
import { evaluateDict } from './literals.js';

// ============================================================
// OPTIONS TYPES
// ============================================================

/** Keywords that take options. `do` covers both loop forms. */
export type ConstructKeyword = 'guard' | 'retry' | 'timeout' | 'pass' | 'do';

/** The evaluated, type-checked options of one control statement run. */
export interface ConstructOptions {
  /** Names of the codes a guard or retry handles; undefined handles every code. */
  readonly on: ReadonlySet<string> | undefined;
  /** Attempt count of a retry, the first attempt included. */
  readonly attempts: number | undefined;
  /** Iteration ceiling of a loop. */
  readonly limit: number | undefined;
  /** Wall-time bound of a timeout. */
  readonly total: RillDuration | undefined;
  /** Inactivity bound of a timeout. */
  readonly idle: RillDuration | undefined;
  /** True when a pass drops catchable halts from its body. */
  readonly ignoreHalts: boolean;
  /** True when a pass runs its body without awaiting it. */
  readonly async: boolean;
}

interface FieldSpec {
  readonly structure: TypeStructure;
  readonly required: boolean;
  /** Value an absent optional field takes; undefined leaves it absent. */
  readonly fallback: RillValue | undefined;
}

const ERROR_CODE_LIST: TypeStructure = {
  kind: 'list',
  element: ERROR_CODE_STRUCTURE,
};

const ON_FIELD: FieldSpec = {
  structure: {
    kind: 'union',
    members: [ERROR_CODE_STRUCTURE, ERROR_CODE_LIST],
  },
  required: false,
  fallback: undefined,
};
const OPTIONAL_DURATION: FieldSpec = {
  structure: { kind: 'duration' },
  required: false,
  fallback: undefined,
};
const OPTIONAL_NUMBER: FieldSpec = {
  structure: { kind: 'number' },
  required: false,
  fallback: undefined,
};
const FLAG: FieldSpec = {
  structure: { kind: 'bool' },
  required: false,
  fallback: false,
};

/** The options type of each keyword: its field names and their specs. */
const OPTION_FIELDS: Readonly<
  Record<ConstructKeyword, Readonly<Record<string, FieldSpec>>>
> = {
  guard: { on: ON_FIELD },
  retry: {
    attempts: {
      structure: { kind: 'number' },
      required: true,
      fallback: undefined,
    },
    on: ON_FIELD,
  },
  timeout: { total: OPTIONAL_DURATION, idle: OPTIONAL_DURATION },
  pass: { ignore_halts: FLAG, async: FLAG },
  do: { limit: OPTIONAL_NUMBER },
};

// ============================================================
// EVALUATION
// ============================================================

/**
 * Evaluate the options of a control statement and check them against the
 * keyword's options type. Runs once per statement run, before the body, so a
 * guard or retry never catches a halt its own options raise.
 *
 * @param s - Evaluator state
 * @param keyword - Keyword whose options type applies
 * @param options - Parsed options dict, or null when none were written
 * @param node - Statement node, for halt locations
 * @returns The options with defaults filled and `on` normalized
 */
export async function evaluateConstructOptions(
  s: EvalState,
  keyword: ConstructKeyword,
  options: DictNode | null,
  node: ASTNode
): Promise<ConstructOptions> {
  const site: TypeHaltSite = {
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
    fn: keyword,
  };
  const given = await mergeEntries(s, keyword, options, site);
  const table = OPTION_FIELDS[keyword];

  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(table, name)) {
      const recognized = Object.keys(table)
        .map((field) => `'${field}'`)
        .join(', ');
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        `Unknown option '${name}' for ${keyword}(...); recognized options are ${recognized}`,
        'runtime',
        { option: name }
      );
    }
  }

  const values: Record<string, RillValue> = {};
  for (const [name, spec] of Object.entries(table)) {
    const value = given[name];
    if (value === undefined) {
      if (spec.required) {
        throwTypeHalt(
          site,
          'TYPE_MISMATCH',
          `Option '${name}' is required by ${keyword}(...)`,
          'runtime',
          { option: name }
        );
      }
      if (spec.fallback !== undefined)
        setDictField(values, name, spec.fallback);
      continue;
    }
    if (!structureMatches(value, spec.structure)) {
      throwTypeHalt(
        site,
        'TYPE_MISMATCH',
        `Option '${name}' of ${keyword}(...) must be ${formatStructure(spec.structure)}, got ${inferType(value)}`,
        'runtime',
        {
          option: name,
          expectedType: formatStructure(spec.structure),
          actualType: inferType(value),
        }
      );
    }
    if (BOUND_FIELDS.has(name) && !isPositiveInteger(value)) {
      throwCatchableHostHalt(
        site,
        'INVALID_INPUT',
        `Option '${name}' of ${keyword}(...) must be a positive integer, got ${formatValue(value)}`,
        { option: name }
      );
    }
    setDictField(values, name, value);
  }

  const total = values['total'];
  const idle = values['idle'];
  return {
    on: codeNames(values['on'], keyword, site),
    attempts: numberOf(values['attempts']),
    limit: numberOf(values['limit']),
    total: total !== undefined && isDuration(total) ? total : undefined,
    idle: idle !== undefined && isDuration(idle) ? idle : undefined,
    ignoreHalts: values['ignore_halts'] === true,
    async: values['async'] === true,
  };
}

/**
 * Evaluate every entry on its own, as a one-entry dict, and merge the fields.
 * An entry that is not a spread contributes its written or computed keys; a
 * field that two entries both supply halts `#INVALID_INPUT`.
 */
async function mergeEntries(
  s: EvalState,
  keyword: ConstructKeyword,
  options: DictNode | null,
  site: TypeHaltSite
): Promise<Record<string, RillValue>> {
  const merged: Record<string, RillValue> = {};
  if (options === null) return merged;
  for (const entry of options.entries) {
    const single: DictNode = {
      type: 'Dict',
      entries: [entry],
      defaultValue: null,
      span: entry.span,
    };
    const fields = await evaluateDict(s, single);
    for (const [name, value] of Object.entries(fields)) {
      if (Object.hasOwn(merged, name)) {
        throwCatchableHostHalt(
          site,
          'INVALID_INPUT',
          `Option '${name}' is given more than once in ${keyword}(...)`,
          { option: name }
        );
      }
      setDictField(merged, name, value);
    }
  }
  return merged;
}

/**
 * Normalize the checked `on` value to a set of code names: a single atom
 * becomes a one-element set. An empty list names no code and halts.
 */
function codeNames(
  value: RillValue | undefined,
  keyword: ConstructKeyword,
  site: TypeHaltSite
): ReadonlySet<string> | undefined {
  if (value === undefined) return undefined;
  if (isAtom(value)) return new Set([value.atom.name]);
  if (!Array.isArray(value)) return undefined;
  const names = new Set<string>();
  for (const code of value) {
    if (isAtom(code)) names.add(code.atom.name);
  }
  if (names.size === 0) {
    throwCatchableHostHalt(
      site,
      'INVALID_INPUT',
      `Option 'on' of ${keyword}(...) is an empty list; omit it to handle every catchable halt`,
      { option: 'on' }
    );
  }
  return names;
}

/** Options that bound how often a body runs. */
const BOUND_FIELDS: ReadonlySet<string> = new Set(['attempts', 'limit']);

function isPositiveInteger(value: RillValue): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function numberOf(value: RillValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
