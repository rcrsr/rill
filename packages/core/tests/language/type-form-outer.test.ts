/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Type form outer
 *
 * An outer type follows the parentheses or a bare type name. `stream`
 * accepts one in every type position; list, dict, tuple, ordered, and union
 * reject it. Inside an inner, `name:` starts a named field instead.
 */

import { describe, expect } from 'vitest';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

async function expectOuterRejected(source: string): Promise<void> {
  await expect(run(source)).rejects.toMatchObject({ errorId: 'RILL-P006' });
}

describe('Rill Language: Type form outer', () => {
  rule('type-form.uniform').it(
    'reads name(inner):outer into inner and outer slots',
    async () => {
      expect(await run('stream(number):string => $t\n$t.inner == number')).toBe(
        true
      );
      expect(await run('stream(number):string => $t\n$t.outer == string')).toBe(
        true
      );
    }
  );

  rule('type-form.uniform').it(
    'keeps a colon before a type variable an assertion',
    async () => {
      await expectHalt(() => run('"a" => $t\nstream(number):$t'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('stream.position').it(
    'accepts an outer after an assertion colon',
    async () => {
      await expectHalt(() => run('1 -> :stream(number):string'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('stream.position').it(
    'accepts an outer after a check colon',
    async () => {
      expect(await run('1 -> :?stream(number):string')).toBe(false);
    }
  );

  rule('stream.position').it(
    'accepts an outer in a capture annotation',
    async () => {
      await expectHalt(() => run('1 => $s:stream(number):string'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('stream.position').it(
    'accepts an outer in a closure parameter type',
    async () => {
      expect(
        await run('|s: stream(number):string| ($s) => $f\n$f.^type.signature')
      ).toBe('|s: stream(number):string| :any');
    }
  );

  rule('stream.position').it(
    'accepts an outer in a type argument',
    async () => {
      expect(await run('list(stream(number):string) => $t\n$t.signature')).toBe(
        'list(stream(number):string)'
      );
    }
  );

  rule('stream.position').it('accepts an outer as a union member', async () => {
    expect(
      await run('union(stream(number):string, string) => $t\n$t.signature')
    ).toBe('union(stream(number):string, string)');
  });

  rule('list.no-outer').it(
    'rejects an outer on list in expression position',
    async () => {
      await expectOuterRejected('list(number):string');
    }
  );

  rule('list.no-outer').it(
    'rejects an outer on list in type position',
    async () => {
      await expectOuterRejected('1 -> :list(number):string');
      await expectOuterRejected('1 => $x:list(number):string');
    }
  );

  rule('dict.no-outer').it(
    'rejects an outer on dict in expression position',
    async () => {
      await expectOuterRejected('dict(a: number):string');
    }
  );

  rule('dict.no-outer').it(
    'rejects an outer on dict in type position',
    async () => {
      await expectOuterRejected('1 -> :dict(a: number):string');
      await expectOuterRejected('1 => $x:dict(a: number):string');
    }
  );

  rule('tuple.no-outer').it(
    'rejects an outer on tuple in expression position',
    async () => {
      await expectOuterRejected('tuple(number):string');
    }
  );

  rule('tuple.no-outer').it(
    'rejects an outer on tuple in type position',
    async () => {
      await expectOuterRejected('1 -> :tuple(number):string');
      await expectOuterRejected('1 => $x:tuple(number):string');
    }
  );

  rule('ordered.no-outer').it(
    'rejects an outer on ordered in expression position',
    async () => {
      await expectOuterRejected('ordered(a: number):string');
    }
  );

  rule('ordered.no-outer').it(
    'rejects an outer on ordered in type position',
    async () => {
      await expectOuterRejected('1 -> :ordered(a: number):string');
      await expectOuterRejected('1 => $x:ordered(a: number):string');
    }
  );

  rule('union.no-outer').it(
    'rejects an outer on union in expression position',
    async () => {
      await expectOuterRejected('union(number, string):string');
    }
  );

  rule('union.no-outer').it(
    'rejects an outer on union in type position',
    async () => {
      await expectOuterRejected('1 -> :union(number, string):string');
      await expectOuterRejected('1 => $x:union(number, string):string');
    }
  );

  rule('list.no-outer').it(
    'rejects an outer nested in a type argument',
    async () => {
      await expectOuterRejected('list(list(number):string)');
    }
  );

  rule('type-form.uniform', 'type-form.name').it(
    'reads a bare name with an outer as the unspecified inner',
    async () => {
      expect(await run('stream:number == stream(any):number')).toBe(true);
      expect(await run('(stream:number).signature')).toBe('stream(any):number');
      expect(await run('"x" -> :?stream:number')).toBe(false);
      expect(
        await run('|s: stream:string| { $s } => $f\n$f.^type.signature')
      ).toBe('|s: stream(any):string| :any');
      expect(
        await run('dict(a: stream:number) == dict(a: stream(any):number)')
      ).toBe(true);
    }
  );

  rule('type-form.uniform').it(
    'reads name: inside an inner as a named field, not an outer',
    async () => {
      expect(await run('dict(stream: number).signature')).toBe(
        'dict(stream: number)'
      );
      expect(
        await run('tuple(stream():number) == tuple(stream(any):number)')
      ).toBe(true);
    }
  );

  rule('list.no-outer', 'dict.no-outer').it(
    'rejects an outer on a bare list or dict',
    async () => {
      await expectOuterRejected('list:number');
      await expectOuterRejected('"x" -> :?dict:string');
    }
  );
});
