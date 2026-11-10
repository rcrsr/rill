/**
 * Argument and shape validation halts are catchable: `guard` recovers each
 * one, `.!code` carries the expected atom, and the message text is the one
 * the halt always had.
 */

import { anyTypeValue, createVector } from '@rcrsr/rill';
import type { RillFunctionDefinition } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

interface RecoverableCase {
  readonly name: string;
  readonly source: string;
  readonly code: string;
  readonly message: string;
  readonly variables?: Record<string, number[]> | undefined;
}

/** Host-registered vectors for the vector method cases. */
const VECTOR_FUNCTIONS: Record<string, RillFunctionDefinition> = {
  make_vec2: {
    params: [],
    returnType: anyTypeValue,
    fn: () => createVector(new Float32Array([1, 2]), 'm'),
  },
  make_vec3: {
    params: [],
    returnType: anyTypeValue,
    fn: () => createVector(new Float32Array([1, 2, 3]), 'm'),
  },
};

const BIG_LIST: number[] = Array.from({ length: 15000 }, (_, i) => i + 1);

const CASES: readonly RecoverableCase[] = [
  {
    name: 'seq with a non-closure body',
    source: 'list[1] -> seq(5)',
    code: '#TYPE_MISMATCH',
    message: 'seq: body must be a closure, got number',
  },
  {
    name: 'fan with a non-closure body',
    source: 'list[1] -> fan(5)',
    code: '#TYPE_MISMATCH',
    message: 'fan: body must be a closure, got number',
  },
  {
    name: 'acc with a non-closure body',
    source: 'list[1] -> acc(0, 5)',
    code: '#TYPE_MISMATCH',
    message: 'acc: body must be a closure, got number',
  },
  {
    name: 'fold with a non-closure body',
    source: 'list[1] -> fold(0, 5)',
    code: '#TYPE_MISMATCH',
    message: 'fold: body must be a closure, got number',
  },
  {
    name: 'filter with a non-closure body',
    source: 'list[1] -> filter(5)',
    code: '#TYPE_MISMATCH',
    message: 'filter: body must be a closure, got number',
  },
  {
    name: 'range with a zero step',
    source: 'range(0, 5, 0)',
    code: '#INVALID_INPUT',
    message: 'range step cannot be zero',
  },
  {
    name: 'repeat with a negative count',
    source: 'repeat("a", -1)',
    code: '#INVALID_INPUT',
    message: 'repeat: count cannot be negative, got -1',
  },
  {
    name: 'duration ordering across calendar components',
    source: 'duration(1,0,0) < duration(0,0,1)',
    code: '#RILL_R002',
    message: 'Cannot order durations with different calendar components',
  },
  {
    name: 'fan with non-dict options',
    source: 'list[1] -> fan({ $ }, 5)',
    code: '#TYPE_MISMATCH',
    message: 'fan: options must be a dict, got number',
  },
  {
    name: 'fan with non-number concurrency',
    source: 'list[1] -> fan({ $ }, dict[concurrency: "x"])',
    code: '#TYPE_MISMATCH',
    message: 'fan: options.concurrency must be a number, got string',
  },
  {
    name: 'fan with non-integer concurrency',
    source: 'list[1] -> fan({ $ }, dict[concurrency: 0.5])',
    code: '#INVALID_INPUT',
    message: 'fan: options.concurrency must be a positive integer, got 0.5',
  },
  {
    name: 'fan with an unknown option',
    source: 'list[1] -> fan({ $ }, dict[batch: 1])',
    code: '#INVALID_INPUT',
    message:
      "fan: unknown option 'batch'; recognized options are 'concurrency'",
  },
  {
    name: 'filter with non-dict options',
    source: 'list[1] -> filter({ $ }, 5)',
    code: '#TYPE_MISMATCH',
    message: 'filter: options must be a dict, got number',
  },
  {
    name: 'filter with non-number concurrency',
    source: 'list[1] -> filter({ $ }, dict[concurrency: "x"])',
    code: '#TYPE_MISMATCH',
    message: 'filter: options.concurrency must be a number, got string',
  },
  {
    name: 'filter with non-integer concurrency',
    source: 'list[1] -> filter({ $ }, dict[concurrency: 0.5])',
    code: '#INVALID_INPUT',
    message: 'filter: options.concurrency must be a positive integer, got 0.5',
  },
  {
    name: 'filter with an unknown option',
    source: 'list[1] -> filter({ $ }, dict[batch: 1])',
    code: '#INVALID_INPUT',
    message:
      "filter: unknown option 'batch'; recognized options are 'concurrency'",
  },
  {
    name: 'filter predicate returning a non-bool',
    source: 'list[1] -> filter({ 5 })',
    code: '#TYPE_MISMATCH',
    message: 'filter: predicate must return bool, got number',
  },
  {
    name: 'take with a negative count',
    source: 'list[1, 2] -> take(-1)',
    code: '#INVALID_INPUT',
    message: 'take: n cannot be negative, got -1',
  },
  {
    name: 'take with a non-integer count',
    source: 'list[1, 2] -> take(1.5)',
    code: '#INVALID_INPUT',
    message: 'take: n must be an integer, got 1.5',
  },
  {
    name: 'take over the element ceiling on a list',
    source: '$big -> take(20000)',
    code: '#RILL_R010',
    message: 'take: element count exceeded 10000 limit',
    variables: { big: BIG_LIST },
  },
  {
    name: 'skip with a negative count',
    source: 'list[1, 2] -> skip(-1)',
    code: '#INVALID_INPUT',
    message: 'skip: n cannot be negative, got -1',
  },
  {
    name: 'skip with a non-integer count',
    source: 'list[1, 2] -> skip(1.5)',
    code: '#INVALID_INPUT',
    message: 'skip: n must be an integer, got 1.5',
  },
  {
    name: '.repeat with a negative count',
    source: '"ab" -> .repeat(-1)',
    code: '#INVALID_INPUT',
    message: 'repeat: count cannot be negative, got -1',
  },
  {
    name: '.pad_start with a negative length',
    source: '"ab" -> .pad_start(-1)',
    code: '#INVALID_INPUT',
    message: 'pad_start: length cannot be negative, got -1',
  },
  {
    name: '.pad_end with a negative length',
    source: '"ab" -> .pad_end(-1)',
    code: '#INVALID_INPUT',
    message: 'pad_end: length cannot be negative, got -1',
  },
  {
    name: '.pad_start with a non-integer length',
    source: '"ab" -> .pad_start(1.5)',
    code: '#INVALID_INPUT',
    message: 'pad_start: length must be an integer, got 1.5',
  },
  {
    name: 'take past the step ceiling on an iterator',
    source: 'iterate(0, { $ + 1 }) -> take(15000)',
    code: '#RILL_R010',
    message:
      'Iterator/stream exceeded 10000 step limit without producing 15000 value(s)',
  },
  {
    name: 'datetime with a number',
    source: 'datetime(1.5)',
    code: '#TYPE_MISMATCH',
    message: 'datetime input must be a string, got number',
  },
  {
    name: 'datetime with a bool',
    source: 'datetime(true)',
    code: '#TYPE_MISMATCH',
    message: 'datetime input must be a string, got bool',
  },
  {
    name: 'duration with a string component',
    source: 'duration("x", 0, 0)',
    code: '#TYPE_MISMATCH',
    message: 'duration years must be a finite number: x',
  },
  {
    name: 'datetime with a non-number hour',
    source: 'datetime(...dict[year: 2024, month: 1, day: 1, hour: "x"])',
    code: '#TYPE_MISMATCH',
    message: 'Invalid datetime component hour: x',
  },
  {
    name: 'datetime with a non-number unix',
    source: 'datetime(...dict[unix: "x"])',
    code: '#TYPE_MISMATCH',
    message: 'Invalid datetime component unix: x',
  },
  {
    name: 'mixed-type list literal',
    source: 'list[1, "a"]',
    code: '#RILL_R002',
    message:
      'List elements must be the same type: expected number, got string at index 1',
  },
  {
    name: 'mixed-type list literal with a list element',
    source: 'list[1] => $x\nlist[$x, "a"]',
    code: '#RILL_R002',
    message:
      'List elements must be the same type: expected list(number), got string at index 1',
  },
  {
    name: 'slice with a zero step',
    source: 'list[1, 2, 3] -> slice<::0>',
    code: '#INVALID_INPUT',
    message: 'Slice step cannot be zero',
  },
  {
    name: 'list index with a non-integer variable index',
    source: 'list[1, 2, 3] => $l\n$l[1.5]',
    code: '#INVALID_INPUT',
    message: 'List index must be an integer, got 1.5',
  },
  {
    name: '.at with a non-integer index',
    source: 'list[1, 2, 3] -> .at(1.5)',
    code: '#INVALID_INPUT',
    message: 'List index must be an integer, got 1.5',
  },
  {
    name: 'list dispatch with a non-integer index',
    source: '1.5 -> list["a", "b"]',
    code: '#INVALID_INPUT',
    message: 'List index must be an integer, got 1.5',
  },
  {
    name: 'list dispatch of a non-integer through a stored list',
    source: 'list["a", "b"] => $list\n1.5 -> $list',
    code: '#INVALID_INPUT',
    message: 'List index must be an integer, got 1.5',
  },
  {
    name: '.at out of range',
    source: 'list[1, 2, 3] -> .at(5)',
    code: '#RILL_R009',
    message: 'List index out of bounds: 5',
  },
  {
    name: 'list dispatch out of range',
    source: '5 -> list["a", "b"]',
    code: '#RILL_R009',
    message: 'List index out of bounds: 5',
  },
  {
    name: 'datetime.add with a non-duration',
    source: 'datetime("2026-03-13T08:00:00Z") -> .add(5)',
    code: '#TYPE_MISMATCH',
    message: 'datetime.add() requires a duration argument',
  },
  {
    name: 'datetime.diff with a non-datetime',
    source: 'datetime("2026-03-13T08:00:00Z") -> .diff(5)',
    code: '#TYPE_MISMATCH',
    message: 'datetime.diff() requires a datetime argument',
  },
  {
    name: 'duration.add with a non-duration',
    source: 'duration(0,0,1) -> .add(5)',
    code: '#TYPE_MISMATCH',
    message: 'duration.add() requires a duration argument',
  },
  {
    name: 'duration.subtract with a non-duration',
    source: 'duration(0,0,1) -> .subtract(5)',
    code: '#TYPE_MISMATCH',
    message: 'duration.subtract() requires a duration argument',
  },
  {
    name: 'duration.multiply with a non-number',
    source: 'duration(0,0,1) -> .multiply("a")',
    code: '#TYPE_MISMATCH',
    message: 'duration.multiply() requires a number argument',
  },
  {
    name: 'duration.subtract with a negative result',
    source: 'duration(0,0,0,1) -> .subtract(duration(0,0,0,3))',
    code: '#INVALID_INPUT',
    message: 'duration.subtract() would produce negative result',
  },
  {
    name: 'duration.multiply with a negative factor',
    source: 'duration(0,0,1) -> .multiply(-1)',
    code: '#INVALID_INPUT',
    message: 'duration.multiply() requires non-negative number',
  },
  {
    name: 'duration.multiply with a non-finite result',
    source:
      '|x| ($x * $x) => $sq\n10 -> $sq -> $sq -> $sq -> $sq -> $sq -> $sq -> $sq -> $sq => $big\nduration(0,0,1) -> .multiply($big) -> .multiply($big)',
    code: '#INVALID_INPUT',
    message: 'duration.multiply() would produce a non-finite result',
  },
  {
    name: 'duration.multiply with a fractional month result',
    source: 'duration(1,0,0) -> .multiply(0.1)',
    code: '#INVALID_INPUT',
    message: 'duration.multiply() would produce a fractional month value',
  },
  {
    name: '.total_ms on a calendar duration',
    source: 'duration(1,0,0) -> .total_ms',
    code: '#INVALID_INPUT',
    message: 'total_ms is not defined for calendar durations',
  },
  {
    name: '.similarity with a non-vector argument',
    source: 'make_vec2() -> .similarity(1)',
    code: '#TYPE_MISMATCH',
    message: 'expected vector, got number',
  },
  {
    name: '.dot with a non-vector argument',
    source: 'make_vec2() -> .dot(1)',
    code: '#TYPE_MISMATCH',
    message: 'expected vector, got number',
  },
  {
    name: '.distance with a non-vector argument',
    source: 'make_vec2() -> .distance(1)',
    code: '#TYPE_MISMATCH',
    message: 'expected vector, got number',
  },
  {
    name: '.similarity with a dimension mismatch',
    source: 'make_vec2() -> .similarity(make_vec3())',
    code: '#INVALID_INPUT',
    message: 'vector dimension mismatch: 2 vs 3',
  },
  {
    name: '.dot with a dimension mismatch',
    source: 'make_vec2() -> .dot(make_vec3())',
    code: '#INVALID_INPUT',
    message: 'vector dimension mismatch: 2 vs 3',
  },
  {
    name: '.distance with a dimension mismatch',
    source: 'make_vec2() -> .distance(make_vec3())',
    code: '#INVALID_INPUT',
    message: 'vector dimension mismatch: 2 vs 3',
  },
  {
    name: 'chain with a non-closure list element',
    source: '5 -> chain(list[5])',
    code: '#RILL_R040',
    message: 'chain: list element must be a closure, got number',
  },
  {
    name: 'chain with a non-closure second argument',
    source: '5 -> chain(5)',
    code: '#RILL_R040',
    message:
      'chain: second argument must be a closure or list of closures, got number',
  },
];

describe('argument halts are recoverable with guard', () => {
  for (const c of CASES) {
    it(`recovers ${c.name} with the expected atom and message`, async () => {
      const options = {
        functions: VECTOR_FUNCTIONS,
        ...(c.variables ? { variables: c.variables } : {}),
      };
      const invalid = await run(`guard { ${c.source} } => $r\n$r.!`, options);
      const code = await run(
        `guard { ${c.source} } => $r\n"{$r.!code}"`,
        options
      );
      const message = await run(
        `guard { ${c.source} } => $r\n"{$r.!message}"`,
        options
      );

      expect(invalid).toBe(true);
      expect(code).toBe(c.code);
      expect(message).toBe(c.message);
    });
  }
});
