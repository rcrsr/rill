/**
 * `value -> T` and `value -> $T` (with `T => $T`) take one conversion path,
 * so every type text yields the same value or the same halt.
 */

import { describe, expect, it } from 'vitest';
import {
  RuntimeError,
  RuntimeHaltSignal,
  getStatus,
  isCallable,
} from '@rcrsr/rill';
import type { RillValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

type Outcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'halt'; readonly code: string; readonly message: string };

async function outcomeOf(source: string): Promise<Outcome> {
  try {
    const value: RillValue = await run(source);
    return {
      kind: 'value',
      value: isCallable(value) ? 'callable' : value,
    };
  } catch (caught) {
    const invalid =
      caught instanceof RuntimeHaltSignal
        ? caught.value
        : caught instanceof RuntimeError
          ? caught.haltValue
          : undefined;
    if (invalid === undefined) {
      throw caught;
    }
    const status = getStatus(invalid);
    return { kind: 'halt', code: status.code.name, message: status.message };
  }
}

const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['fill', 'dict(a: number, b: number = 5)', 'dict[a: 1]'],
  ['drop', 'dict(a: number)', 'dict[a: 1, z: 9]'],
  ['inner assert', 'dict(a: number)', 'dict[a: "x"]'],
  ['missing required field', 'dict(a: number)', 'dict[]'],
  ['incompatible source', 'dict(a: number)', '5'],
  ['dict to bare ordered', 'ordered', 'dict[a: 1]'],
  ['unparseable string', 'number', '"abc"'],
  ['ordered field order', 'ordered(b: number, a: number)', 'dict[a: 1, b: 2]'],
  ['tuple fill', 'tuple(number, number = 9)', 'list[1]'],
  ['list to tuple', 'tuple(number, number)', 'list[1, 2]'],
  ['uniform dict', 'dict(number)', 'dict[a: 1, b: 2]'],
  ['uniform dict assert', 'dict(number)', 'dict[a: "x"]'],
  ['list assert', 'list(number)', 'list["a"]'],
  ['bare kind', 'list', 'list[1, 2]'],
  ['bare conversion', 'string', '5'],
  ['closure', 'closure', '|x| ($x)'],
];

describe('type target agreement', () => {
  it.each(CASES)(
    'agrees between literal and variable targets for %s',
    async (_name, typeText, valueText) => {
      const literal = await outcomeOf(`${valueText} -> ${typeText}`);
      const variable = await outcomeOf(`${typeText} => $t\n${valueText} -> $t`);

      expect(variable).toEqual(literal);
    }
  );
});
