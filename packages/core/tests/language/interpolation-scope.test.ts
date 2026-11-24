/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Interpolation scope
 *
 * Each `{...}` part of an interpolated string runs in its own child scope:
 * captures made inside a part are not visible after it, while reads of
 * enclosing variables and of the enclosing `$` still work.
 */

import { describe, expect, it } from 'vitest';
import { createLogCollector, run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

describe('Interpolation scope', () => {
  rule('interpolation.scope').it(
    'halts RILL-R005 when a capture made inside a part is read after the string',
    async () => {
      await expectHalt(() => run('"{5 => $q}" => $s\n$q'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
      });
    }
  );

  rule('interpolation.scope').it(
    'halts RILL-R005 when a later part reads a capture made in an earlier part',
    async () => {
      await expectHalt(() => run('"{1 => $a}{$a}"'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
      });
    }
  );

  rule('interpolation.dollar').it(
    'reads the enclosing $ inside a part',
    async () => {
      expect(await run('5 -> "{$}"')).toBe('5');
    }
  );

  it('reads outer variables inside a part', async () => {
    expect(await run('1 => $o\n"{$o}"')).toBe('1');
  });
});

describe('Interpolation reference rules', () => {
  rule('interpolation.non-empty').it(
    'rejects {} and { } with RILL-P004',
    async () => {
      await expect(run('"{}"')).rejects.toMatchObject({ errorId: 'RILL-P004' });
      await expect(run('"{ }"')).rejects.toMatchObject({
        errorId: 'RILL-P004',
      });
    }
  );

  rule('interpolation.brace-escape').it(
    'reads doubled braces as literal braces and rejects a backslash brace with RILL-L005',
    async () => {
      expect(await run('"{{a}} }}"')).toBe('{a} }');
      await expect(run('"\\{a"')).rejects.toMatchObject({
        errorId: 'RILL-L005',
      });
      await expect(run('"a\\}"')).rejects.toMatchObject({
        errorId: 'RILL-L005',
      });
    }
  );

  rule('interpolation.order').it(
    'evaluates each interpolation once, left to right',
    async () => {
      const { logs, callbacks } = createLogCollector();
      expect(
        await run('"{"a" -> log}-{"b" -> log}-{"c" -> log}"', { callbacks })
      ).toBe('a-b-c');
      expect(logs).toEqual(['a', 'b', 'c']);
    }
  );

  rule('interpolation.expression').it(
    'accepts a pipe chain and a nested string',
    async () => {
      expect(await run('"x" -> "<{$ -> .upper}>"')).toBe('<X>');
      expect(await run('"{"in{1 + 1}" -> .len}"')).toBe('3');
      expect(await run('3 => $n\n"n={$n}, next={$n + 1}"')).toBe('n=3, next=4');
    }
  );

  rule('interpolation.dollar').it(
    'halts RILL-R005 for {$} with no $ bound',
    async () => {
      await expectHalt(() => run('"{$}"'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
      });
    }
  );

  rule('interpolation.string').it(
    'inserts a string without quotes',
    async () => {
      expect(await run('"ab" => $s\n"[{$s}]{"cd"}"')).toBe('[ab]cd');
    }
  );

  rule('interpolation.printed').it(
    'inserts the printed form of other values, an atom with # and a type as its signature',
    async () => {
      expect(
        await run(
          '"{list[1, 2]} {#ok} {true} {1.5} {dict[a: "x"]} {number} {list(string)}"'
        )
      ).toBe('list[1, 2] #ok true 1.5 dict[a: "x"] number list(string)');
    }
  );
});
