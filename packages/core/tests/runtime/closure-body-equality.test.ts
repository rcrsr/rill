/**
 * Rill Runtime Tests: Closure equality compares every body node kind
 *
 * Each row holds two closure bodies that differ in exactly one field. The
 * differing pair must compare unequal, and the same body written out twice
 * must compare equal, so a comparator that ignores the field fails the first
 * check and a comparator that over-rejects fails the second.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

interface BodyPair {
  readonly name: string;
  readonly base: string;
  readonly variant: string;
}

const BODY_PAIRS: readonly BodyPair[] = [
  { name: 'binary operator', base: '$x + 1', variant: '$x - 1' },
  { name: 'unary operator', base: '-$x', variant: '!$x' },
  { name: 'grouped expression', base: '($x + 1) * 2', variant: '($x + 2) * 2' },
  { name: 'interpolation', base: '"a {$x + 1}"', variant: '"a {$x + 2}"' },
  { name: 'index access', base: 'list[1, 2][0]', variant: 'list[1, 2][1]' },
  { name: 'computed field access', base: '$x.("a")', variant: '$x.("b")' },
  { name: 'block field access', base: '$x.{"a"}', variant: '$x.{"b"}' },
  {
    name: 'alternatives field access',
    base: '$x.(a || b)',
    variant: '$x.(a || c)',
  },
  { name: 'annotation access', base: '$x.^one', variant: '$x.^two' },
  { name: 'slice', base: '$x -> slice<0:2>', variant: '$x -> slice<0:3>' },
  {
    name: 'destruct',
    base: '$x -> destruct<$a, $b>',
    variant: '$x -> destruct<$a, $c>',
  },
  {
    name: 'destructure',
    base: '$x -> destruct<name: $n>',
    variant: '$x -> destruct<other: $n>',
  },
  {
    name: 'while condition',
    base: '0 -> while ($ < 3) do { $ + 1 }',
    variant: '0 -> while ($ < 4) do { $ + 1 }',
  },
  {
    name: 'while body',
    base: '0 -> while ($ < 3) do { $ + 1 }',
    variant: '0 -> while ($ < 3) do { $ + 2 }',
  },
  {
    name: 'do-while condition',
    base: '0 -> do { $ + 1 } while ($ < 3)',
    variant: '0 -> do { $ + 1 } while ($ < 4)',
  },
  {
    name: 'do-while body',
    base: '0 -> do { $ + 1 } while ($ < 3)',
    variant: '0 -> do { $ + 2 } while ($ < 3)',
  },
  {
    name: 'conditional else branch',
    base: '$x ? "a" ! "b"',
    variant: '$x ? "a" ! "c"',
  },
  { name: 'dict keys', base: 'dict[a: 1]', variant: 'dict[b: 1]' },
  { name: 'tuple', base: 'tuple[1, 2]', variant: 'tuple[1, 3]' },
  { name: 'ordered', base: 'ordered[a: 1]', variant: 'ordered[a: 2]' },
  { name: 'list spread', base: 'list[...$x]', variant: 'list[...$y]' },
  { name: 'capture name', base: '$x => $p', variant: '$x => $q' },
  { name: 'capture type', base: '$x => $p:number', variant: '$x => $p:string' },
  {
    name: 'method arguments',
    base: '$x -> .pad_start(3)',
    variant: '$x -> .pad_start(4)',
  },
  { name: 'host call name', base: 'one($x)', variant: 'two($x)' },
  { name: 'invoke', base: '$x(1)', variant: '$x(2)' },
  { name: 'pipe invoke', base: '$x -> $(1)', variant: '$x -> $(2)' },
  {
    name: 'annotated statement',
    base: '^(a: 1) $x + 1',
    variant: '^(a: 2) $x + 1',
  },
  {
    name: 'while loop limit',
    base: '0 -> while ($ < 3) do<limit: 5> { $ + 1 }',
    variant: '0 -> while ($ < 3) do<limit: 9> { $ + 1 }',
  },
  {
    name: 'do-while loop limit',
    base: '0 -> do<limit: 5> { $ + 1 } while ($ < 3)',
    variant: '0 -> do<limit: 9> { $ + 1 } while ($ < 3)',
  },
  { name: 'type assertion', base: '$x -> :number', variant: '$x -> :string' },
  { name: 'type check', base: '$x -> :?number', variant: '$x -> :?string' },
  {
    name: 'guard block',
    base: 'guard { $x + 1 }',
    variant: 'guard { $x + 2 }',
  },
  {
    name: 'retry block',
    base: 'retry<limit: 2> { $x }',
    variant: 'retry<limit: 3> { $x }',
  },
  {
    name: 'timeout block',
    base: 'timeout<total: duration(0,0,0,0,0,0,500)> { $x }',
    variant: 'timeout<total: duration(0,0,0,0,0,0,600)> { $x }',
  },
  { name: 'atom literal', base: '#RILL_R001', variant: '#RILL_R002' },
  { name: 'status probe', base: '$x.!code', variant: '$x.!message' },
  {
    name: 'assert',
    base: 'assert ($x > 0) "a"',
    variant: 'assert ($x > 0) "b"',
  },
  { name: 'error', base: 'error "a"', variant: 'error "b"' },
  {
    name: 'type constructor',
    base: '$x -> :list(number)',
    variant: '$x -> :list(string)',
  },
  { name: 'use expression', base: 'use<ext:a>', variant: 'use<ext:b>' },
  {
    name: 'pass block',
    base: 'pass<on_error: #IGNORE> { 1 }',
    variant: 'pass<on_error: #IGNORE> { 2 }',
  },
  { name: 'host reference', base: 'ns::one', variant: 'ns::two' },
];

function buildScript(first: string, second: string): string {
  return `
    |x|{ ${first} } => $a
    |x|{ ${second} } => $b
    $a == $b
  `;
}

describe('closure body equality', () => {
  describe.each(BODY_PAIRS)('$name', ({ base, variant }) => {
    it('identical bodies compare equal', async () => {
      expect(await run(buildScript(base, base))).toBe(true);
    });

    it('bodies differing in this field compare unequal', async () => {
      expect(await run(buildScript(base, variant))).toBe(false);
    });
  });
});
