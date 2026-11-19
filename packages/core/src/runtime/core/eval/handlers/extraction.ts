/**
 * Extraction Operators
 *
 * Handles destructure, slice, and spread operations for extracting
 * values from lists and dicts.
 *
 * @internal
 */

import type {
  DestructureNode,
  SliceNode,
  ListLiteralNode,
  DictLiteralNode,
  TupleLiteralNode,
  OrderedLiteralNode,
  ExpressionNode,
  ListSpreadNode,
  DictEntryNode,
  SourceLocation,
} from '../../../../types.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import {
  locateField,
  projectLocated,
  throwBracketMiss,
} from './field-access.js';
import { createOrdered, createTuple } from '../../types/constructors.js';
import {
  isOrdered,
  isPlainDict,
  isTuple,
  orderedValueEntries,
  positionalElements,
} from '../../types/guards.js';
import { inferType } from '../../types/registrations.js';
import { getVariable } from '../../context.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { resolveTypeRef, assertType } from './types.js';
import { setVariable, evaluateVariable } from './variables.js';
import { evaluateExpression } from './core.js';
import { accessHaltGateFast } from './access.js';
import { isKeyedSource } from './collections.js';
import { setDictField, throwSourceKindHalt } from '../shared.js';
import { orderedDictEntries } from '../../types/dict-keys.js';
import { rejectHeldEntries } from '../../types/held-block.js';
import {
  assertUsableDictKey,
  assertStringVariableKey,
  assertStringComputedKey,
  evaluateDictMultiKeyFromList,
  evaluateEntryValue,
} from './literals.js';

/**
 * Evaluate destructure operator: destruct<$a, $b, $c>
 * Extracts values from list or dict into variables.
 *
 * List destructure: [1, 2, 3] -> destruct<$a, $b, $c>  # $a=1, $b=2, $c=3
 * Dict destructure: [x: 1, y: 2] -> destruct<x: $a, y: $b>  # $a=1, $b=2
 */
export async function evaluateDestructure(
  s: EvalState,
  node: Pick<DestructureNode, 'elements' | 'span'>,
  input: RillValue,
  inputDeclared?: TypeStructure
): Promise<RillValue> {
  const firstNonSkip = node.elements.find((e) => e.kind !== 'skip');
  const isKeyPattern = firstNonSkip?.kind === 'keyValue';

  if (isKeyPattern) {
    // Dict destructure pattern
    if (!isKeyedSource(input)) {
      throwSourceKindHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDestructure',
        },
        'Key destructure',
        ['dict', 'ordered'],
        input
      );
    }

    for (const elem of node.elements) {
      if (elem.kind === 'skip') continue;

      if (elem.kind === 'nested') {
        throwCatchableHostHalt(
          {
            location: elem.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDestructure',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Nested destructure not supported in dict patterns'
        );
      }

      if (elem.kind !== 'keyValue' || elem.key === null || elem.name === null) {
        throwCatchableHostHalt(
          {
            location: elem.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDestructure',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Dict destructure requires key: $var patterns'
        );
      }

      // Own-key gate: an inherited member (constructor, __proto__, ...) must
      // not satisfy a destructure key.
      const located = locateField(input, elem.key);
      if (!located.found) {
        throwBracketMiss(
          input,
          elem.key,
          located.miss,
          {
            location: elem.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDestructure',
          },
          {
            key: elem.key,
            availableKeys: isOrdered(input)
              ? orderedValueEntries(input).map(([k]) => k)
              : Object.keys(input),
          }
        );
      }

      const dictResolved =
        elem.typeRef !== null
          ? await resolveTypeRef(s, elem.typeRef, (name: string) =>
              getVariable(s.ctx, name)
            )
          : undefined;
      if (dictResolved !== undefined) {
        assertType(s, located.value, dictResolved.structure, elem.span.start);
      }
      setVariable(
        s,
        elem.name,
        located.value,
        dictResolved?.structure,
        elem.span.start,
        projectLocated(inputDeclared, located)
      );
    }
  } else {
    // List destructure pattern
    const listInput = positionalElements(input);
    if (listInput === undefined) {
      throwSourceKindHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDestructure',
        },
        'Positional destructure',
        ['list', 'tuple'],
        input
      );
    }

    if (node.elements.length !== listInput.length) {
      throwCatchableHostHalt(
        {
          location: node.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDestructure',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Destructure pattern has ${node.elements.length} elements, ${inferType(input)} has ${listInput.length}`
      );
    }

    for (let i = 0; i < node.elements.length; i++) {
      const elem = node.elements[i];
      if (elem === undefined || elem.kind === 'skip') continue;

      // The length check above puts every position in range.
      const located = locateField(input, i);
      if (!located.found) continue;

      if (elem.kind === 'nested' && elem.nested) {
        await evaluateDestructure(
          s,
          elem.nested,
          located.value,
          projectLocated(inputDeclared, located)
        );
        continue;
      }

      if (elem.name === null) {
        throwCatchableHostHalt(
          {
            location: elem.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDestructure',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Invalid destructure element'
        );
      }

      const listResolved =
        elem.typeRef !== null
          ? await resolveTypeRef(s, elem.typeRef, (name: string) =>
              getVariable(s.ctx, name)
            )
          : undefined;
      if (listResolved !== undefined) {
        assertType(s, located.value, listResolved.structure, elem.span.start);
      }
      setVariable(
        s,
        elem.name,
        located.value,
        listResolved?.structure,
        elem.span.start,
        projectLocated(inputDeclared, located)
      );
    }
  }

  return input;
}

/**
 * Evaluate slice operator: /<start:stop:step>
 * Extracts a portion of a list or string using Python-style slicing.
 *
 * Examples:
 * [0, 1, 2, 3, 4] -> /<0:3>    # [0, 1, 2]
 * [0, 1, 2, 3, 4] -> /<-2:>    # [3, 4]
 * [0, 1, 2, 3, 4] -> /<::-1>   # [4, 3, 2, 1, 0]
 * "hello" -> /<1:4>             # "ell"
 */
export async function evaluateSlice(
  s: EvalState,
  node: SliceNode,
  input: RillValue
): Promise<RillValue> {
  if (typeof input === 'string') {
    const bounds = await evaluateSliceBounds(s, node);
    return applySlice(
      s,
      input,
      input.length,
      bounds.start,
      bounds.stop,
      bounds.step
    );
  }

  const positional = positionalElements(input);
  if (positional === undefined) {
    return throwSourceKindHalt(
      {
        location: node.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateSlice',
      },
      'Slice',
      ['list', 'tuple', 'string'],
      input
    );
  }

  const bounds = await evaluateSliceBounds(s, node);
  const picked = applySlice(
    s,
    positional,
    positional.length,
    bounds.start,
    bounds.stop,
    bounds.step
  );
  return isTuple(input) ? createTuple(picked) : picked;
}

/** Evaluate the start, stop, and step bounds of a slice node in order. */
async function evaluateSliceBounds(
  s: EvalState,
  node: SliceNode
): Promise<{
  readonly start: number | null;
  readonly stop: number | null;
  readonly step: number | null;
}> {
  const start = node.start
    ? await evaluateSliceBound(s, node.start, node.span.start)
    : null;
  const stop = node.stop
    ? await evaluateSliceBound(s, node.stop, node.span.start)
    : null;
  const step = node.step
    ? await evaluateSliceBound(s, node.step, node.span.start)
    : null;
  return { start, stop, step };
}

/**
 * Evaluate a slice bound expression (start, stop, or step).
 * Returns the numeric value of the bound.
 */
async function evaluateSliceBound(
  s: EvalState,
  bound: SliceNode['start'],
  location?: SourceLocation
): Promise<number> {
  if (bound === null) {
    throwCatchableHostHalt(
      { location, sourceId: s.ctx.sourceId, fn: 'evaluateSliceBound' },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Slice bound is null'
    );
  }

  switch (bound.type) {
    case 'NumberLiteral':
      return bound.value;

    case 'Variable': {
      const value = evaluateVariable(s, bound);
      if (typeof value !== 'number') {
        throwCatchableHostHalt(
          {
            location: bound.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateSliceBound',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Slice bound must be number, got ${typeof value}`
        );
      }
      return value;
    }

    case 'GroupedExpr': {
      const value = await evaluateExpression(s, bound.expression);
      if (typeof value !== 'number') {
        throwCatchableHostHalt(
          {
            location: bound.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateSliceBound',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Slice bound must be number, got ${typeof value}`
        );
      }
      return value;
    }
  }
  return throwFatalHostHalt(
    { location, sourceId: s.ctx.sourceId, fn: 'evaluateSliceBound' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unsupported slice bound'
  );
}

/**
 * Apply Python-style slice to a list or string.
 * Handles negative indices, step values, and edge cases.
 */
function applySlice(
  s: EvalState,
  input: readonly RillValue[],
  len: number,
  start: number | null,
  stop: number | null,
  step: number | null
): RillValue[];
function applySlice(
  s: EvalState,
  input: string,
  len: number,
  start: number | null,
  stop: number | null,
  step: number | null
): string;
function applySlice(
  s: EvalState,
  input: readonly RillValue[] | string,
  len: number,
  start: number | null,
  stop: number | null,
  step: number | null
): RillValue[] | string {
  // Strings slice by Unicode code point, not UTF-16 code unit: an astral
  // character such as "😀" occupies a single index and is never split into a
  // lone surrogate. Index into this array (and use its length as the bound)
  // instead of the raw string, then join back for the string result.
  const codePoints = typeof input === 'string' ? Array.from(input) : [];
  const effectiveLen = typeof input === 'string' ? codePoints.length : len;

  const actualStep = step ?? 1;

  if (actualStep === 0) {
    throwCatchableHostHalt(
      { sourceId: s.ctx.sourceId, fn: 'applySlice' },
      'INVALID_INPUT',
      'Slice step cannot be zero'
    );
  }

  // Bounds must be integers: a fractional bound generates fractional indices
  // whose `input[i]` reads are `undefined`, which would leak into the result
  // list. Halt with a catchable #INVALID_INPUT instead (matching take(1.5)).
  for (const [label, bound] of [
    ['start', start],
    ['stop', stop],
    ['step', step],
  ] as const) {
    if (bound !== null && !Number.isInteger(bound)) {
      throwCatchableHostHalt(
        { sourceId: s.ctx.sourceId, fn: 'applySlice' },
        'INVALID_INPUT',
        `Slice ${label} must be an integer, got ${bound}`
      );
    }
  }

  const normalizeIndex = (
    idx: number | null,
    defaultVal: number,
    forStep: number
  ): number => {
    if (idx === null) return defaultVal;
    let normalized = idx < 0 ? effectiveLen + idx : idx;
    if (forStep > 0) {
      normalized = Math.max(0, Math.min(effectiveLen, normalized));
    } else {
      normalized = Math.max(-1, Math.min(effectiveLen - 1, normalized));
    }
    return normalized;
  };

  const actualStart = normalizeIndex(
    start,
    actualStep > 0 ? 0 : effectiveLen - 1,
    actualStep
  );
  const actualStop = normalizeIndex(
    stop,
    actualStep > 0 ? effectiveLen : -1,
    actualStep
  );

  const indices: number[] = [];
  if (actualStep > 0) {
    for (let i = actualStart; i < actualStop; i += actualStep) {
      indices.push(i);
    }
  } else {
    for (let i = actualStart; i > actualStop; i += actualStep) {
      indices.push(i);
    }
  }

  if (typeof input === 'string') {
    return indices.map((i) => codePoints[i]).join('');
  }
  const picked: RillValue[] = [];
  for (const i of indices) {
    const item = input[i];
    if (item === undefined) {
      return throwFatalHostHalt(
        { sourceId: s.ctx.sourceId, fn: 'applySlice' },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Slice index out of range'
      );
    }
    picked.push(item);
  }
  return picked;
}

/**
 * Evaluate collection literals.
 * Handles list[...], dict[...], tuple[...], ordered[...] keyword forms.
 *
 * Ellipsis spread (...$other) expands referenced collections inline.
 * Type is fixed by the keyword — no runtime inference from content.
 *
 * Returns:
 * - ListLiteralNode  -> RillValue[] (plain list)
 * - DictLiteralNode  -> Record<string, RillValue>
 * - TupleLiteralNode -> RillTuple
 * - OrderedLiteralNode -> RillOrdered
 */
export async function evaluateCollectionLiteral(
  s: EvalState,
  node:
    | ListLiteralNode
    | DictLiteralNode
    | TupleLiteralNode
    | OrderedLiteralNode
): Promise<RillValue> {
  switch (node.type) {
    case 'ListLiteral': {
      const listItems = await evaluateListLiteralElements(s, node.elements);
      return listItems;
    }

    case 'TupleLiteral': {
      // Tuples allow mixed types — no homogeneity check
      const items = await evaluateListLiteralElements(s, node.elements);
      return createTuple(items);
    }

    case 'DictLiteral': {
      const result: Record<string, RillValue> = {};
      for (const [key, value] of await evaluateDictLiteralEntries(
        s,
        node.entries
      )) {
        // Safe assignment so a `__proto__` key becomes an own field rather
        // than reparenting the dict via the prototype setter.
        setDictField(result, key, value);
      }
      return result;
    }

    case 'OrderedLiteral': {
      return createOrdered(await evaluateDictLiteralEntries(s, node.entries));
    }
  }
  return throwFatalHostHalt(
    { sourceId: s.ctx.sourceId, fn: 'evaluateCollectionLiteral' },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    'Unsupported collection literal'
  );
}

/**
 * Evaluate list/tuple literal elements, expanding spread nodes inline.
 * Spread: ...$other expands the referenced collection into the result.
 */
export async function evaluateListLiteralElements(
  s: EvalState,
  rawElements: (ExpressionNode | ListSpreadNode)[]
): Promise<RillValue[]> {
  const result: RillValue[] = [];
  for (const elem of rawElements) {
    if (elem.type === 'ListSpread') {
      const spreadValue = accessHaltGateFast(
        await evaluateExpression(s, elem.expression),
        'evaluateListLiteralElements',
        () => elem.span?.start,
        s.ctx.sourceId
      );
      const spreadElements = positionalElements(spreadValue);
      if (spreadElements !== undefined) {
        rejectHeldEntries(
          spreadValue,
          'spread',
          {
            location: elem.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateListLiteralElements',
          },
          'direct'
        );
        for (const spreadElement of spreadElements) {
          result.push(
            accessHaltGateFast(
              spreadElement,
              'evaluateListLiteralElements',
              () => elem.span?.start,
              s.ctx.sourceId
            )
          );
        }
      } else {
        throwSourceKindHalt(
          {
            location: elem.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateListLiteralElements',
          },
          'Spread in list literal',
          ['list', 'tuple'],
          spreadValue
        );
      }
    } else {
      result.push(
        await evaluateEntryValue(s, elem, 'evaluateListLiteralElements')
      );
    }
  }
  return result;
}

/**
 * Evaluate dict/ordered literal entries, returning [key, value] pairs. Keys are
 * returned as strings. Multi-key list elements, variable keys and computed
 * keys must be strings, as in dict literals; any other value halts.
 * Spread entries (...$other) expand inline (dict keys merged).
 */
async function evaluateDictLiteralEntries(
  s: EvalState,
  entries: DictEntryNode[]
): Promise<[string, RillValue][]> {
  // Keyed by the string key so a spread-introduced key that a
  // later literal key (or a later spread) overrides keeps its original
  // position — matching plain-object/Map override semantics — instead of
  // being appended again at the end.
  const merged = new Map<string, [string, RillValue]>();
  const setMergedEntry = (
    key: string,
    value: RillValue,
    location: SourceLocation | undefined
  ): void => {
    const gated = accessHaltGateFast(
      value,
      'evaluateDictLiteralEntries',
      () => location,
      s.ctx.sourceId
    );
    merged.set(key, [key, gated]);
  };

  for (const entry of entries) {
    const key = entry.key;

    // Spread entry: the parser encodes `...$expr` as a DictEntry with the
    // literal key '...' and no keyForm (a real `["...": x]` string key
    // always carries keyForm, so this check cannot collide with it).
    if (key === '...' && entry.keyForm === undefined) {
      const spreadValue = accessHaltGateFast(
        await evaluateExpression(s, entry.value),
        'evaluateDictLiteralEntries',
        () => entry.span?.start,
        s.ctx.sourceId
      );
      rejectHeldEntries(
        spreadValue,
        'spread',
        {
          location: entry.span?.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDictLiteralEntries',
        },
        'direct'
      );
      if (isOrdered(spreadValue)) {
        for (const [k, v] of orderedValueEntries(spreadValue)) {
          setMergedEntry(k, v, entry.span?.start);
        }
      } else if (isPlainDict(spreadValue)) {
        for (const { key: k, value: v } of orderedDictEntries(spreadValue)) {
          setMergedEntry(k, v, entry.span?.start);
        }
      } else {
        throwSourceKindHalt(
          {
            location: entry.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDictLiteralEntries',
          },
          'Spread in dict/ordered literal',
          ['dict', 'ordered'],
          spreadValue
        );
      }
      continue;
    }

    let stringKey: string;

    if (typeof key === 'string') {
      stringKey = key;
      assertUsableDictKey(s, stringKey, entry.span);
    } else {
      // Object key (DictKeyVariable or DictKeyComputed) — evaluate like evaluateDict
      if ('kind' in key) {
        if (key.kind === 'variable') {
          const varVal = evaluateVariable(s, {
            type: 'Variable',
            span: {
              start: { line: 0, column: 0, offset: 0 },
              end: { line: 0, column: 0, offset: 0 },
            },
            name: key.variableName,
            isPipeVar: false,
            accessChain: [],
            defaultValue: null,
            existenceCheck: null,
          });
          assertStringVariableKey(
            s,
            varVal,
            entry.span,
            'evaluateDictLiteralEntries'
          );
          stringKey = varVal;
        } else {
          // computed: evaluate expression
          const computed = await evaluateExpression(s, key.expression);
          assertStringComputedKey(
            s,
            computed,
            entry.span,
            'evaluateDictLiteralEntries'
          );
          stringKey = computed;
        }
        assertUsableDictKey(s, stringKey, entry.span);
      } else {
        // Multi-key entry (ListLiteralNode key): one entry per listed key.
        const pairs = await evaluateDictMultiKeyFromList(s, key, entry.value);
        for (const [k, v] of pairs) {
          assertUsableDictKey(s, k, entry.span);
          setMergedEntry(k, v, entry.span?.start);
        }
        continue;
      }
    }

    setMergedEntry(
      stringKey,
      await evaluateEntryValue(s, entry.value, 'evaluateDictLiteralEntries'),
      entry.span?.start
    );
  }
  return [...merged.values()];
}
