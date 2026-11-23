/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: destruct<> and slice<> Keyword Forms
 * Tests for the keyword-prefixed destructure and slice pipe targets.
 *
 * Feature: Phase 1 keyword extraction operators (task 1.2)
 * Covers: AC-7, AC-8, AC-9, AC-10, AC-41, AC-42, AC-43, EC-6, EC-7, EC-8, EC-9
 *
 * IMPLEMENTATION NOTE on destruct<>:
 * The destruct<> keyword form parses correctly to a DestructNode
 * but the evaluatePipeTarget() switch in core.ts is missing the
 * 'Destruct' case. The evaluateDestruct() method exists in
 * ExtractionMixin but is not wired up.
 *
 * destruct<> tests are skipped pending that wire-up and are
 * documented as a known bug (BUG-1 in Implementation Notes).
 *
 * slice<> is fully functional and tested below.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run, runWithContext } from '../helpers/runtime.js';

describe('Rill Language: destruct<> and slice<> Keyword Forms', () => {
  // ============================================================
  // slice<> - FULLY IMPLEMENTED
  // ============================================================

  describe('slice<start:stop> keyword form (AC-8)', () => {
    it('returns elements at indices 1, 2, 3 for slice<1:4>', async () => {
      const result = await run(
        'list[1, 2, 3, 4, 5] => $data\n$data -> slice<1:4>'
      );
      expect(result).toEqual([2, 3, 4]);
    });

    it('slices from beginning with :stop', async () => {
      const result = await run(
        'list[1, 2, 3, 4, 5] => $data\n$data -> slice<:3>'
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it('slices to end with start:', async () => {
      const result = await run(
        'list[1, 2, 3, 4, 5] => $data\n$data -> slice<2:>'
      );
      expect(result).toEqual([3, 4, 5]);
    });
  });

  describe('slice<-1:> returns last element (AC-9)', () => {
    rule('slice.negative').it(
      'slice<-1:> returns the last element as a list',
      async () => {
        const result = await run(
          'list[1, 2, 3, 4, 5] => $data\n$data -> slice<-1:>'
        );
        expect(result).toEqual([5]);
      }
    );

    it('slice<-2:> returns last two elements', async () => {
      const result = await run(
        'list[1, 2, 3, 4, 5] => $data\n$data -> slice<-2:>'
      );
      expect(result).toEqual([4, 5]);
    });
  });

  describe('slice<:> full range is valid (AC-41)', () => {
    it('slice<:> returns a copy of the full list', async () => {
      const result = await run('list[1, 2, 3] => $data\n$data -> slice<:>');
      expect(result).toEqual([1, 2, 3]);
    });

    it('slice<:> on empty list returns empty', async () => {
      const result = await run('list[] => $data\n$data -> slice<:>');
      expect(result).toEqual([]);
    });
  });

  describe('slice<0:0> returns empty collection (AC-42)', () => {
    it('slice<0:0> produces empty list', async () => {
      const result = await run('list[1, 2, 3] => $data\n$data -> slice<0:0>');
      expect(result).toEqual([]);
    });
  });

  describe('slice parse errors', () => {
    it('throws ParseError for slice<> with no colon (EC-8)', () => {
      expect(() => parse('list[1,2,3] => $d\n$d -> slice<1>')).toThrow(
        ParseError
      );
    });

    it('throws ParseError for unclosed slice< (EC-9)', () => {
      expect(() => parse('list[1,2,3] => $d\n$d -> slice<1:')).toThrow(
        ParseError
      );
    });
  });

  // ============================================================
  // destruct<> - PARSE VERIFIED, EVALUATION SKIPPED (BUG-1)
  // ============================================================

  describe('destruct<> parse validation', () => {
    it('destruct<$a, $b, $c> parses without error', () => {
      // Verify the keyword form parses correctly even though
      // evaluation is not yet wired up.
      expect(() =>
        parse('list[1, 2, 3] => $data\n$data -> destruct<$a, $b, $c>')
      ).not.toThrow();
    });

    it('destruct<$a, _, $c> parses without error', () => {
      expect(() =>
        parse('list[1, 2, 3] => $data\n$data -> destruct<$a, _, $c>')
      ).not.toThrow();
    });

    it('destruct<_> with only skip target parses (AC-43)', () => {
      expect(() =>
        parse('list[1] => $data\n$data -> destruct<_>')
      ).not.toThrow();
    });

    it('throws ParseError for unclosed destruct< (EC-6)', () => {
      expect(() => parse('list[1, 2] => $d\n$d -> destruct<$a')).toThrow(
        ParseError
      );
    });

    it('throws ParseError for expression in destruct (EC-7, AC-31)', () => {
      // destruct<$a + 1> is not valid — only variable names and _ allowed
      expect(() => parse('list[1, 2] => $d\n$d -> destruct<$a + 1>')).toThrow(
        ParseError
      );
    });
  });

  describe('destruct<> mixed pattern', () => {
    function parseError(source: string): ParseError {
      try {
        parse(source);
      } catch (e) {
        if (e instanceof ParseError) return e;
        throw e;
      }
      throw new Error('expected a ParseError');
    }

    rule('destruct.no-mix').it.each([
      ['list[1, 2] -> destruct<$a, b: $c>', 'b: $c'],
      ['dict[a: 1] -> destruct<a: $x, $y>', '$y'],
      ['dict[a: 1] -> destruct<a: $x, _>', '_>'],
      ['dict[a: 1] -> destruct<_, a: $x>', 'a: $x'],
      ['list[list[1, 2]] -> destruct<destruct<$a, k: $b>>', 'k: $b'],
      ['dict[a: 1] -> destruct<a: $x, destruct<$b>>', 'destruct<$b>'],
    ])('rejects mixed pattern %s at the offending element', (source, at) => {
      const err = parseError(source);
      expect(err.errorId).toBe('RILL-P026');
      expect(err.location?.column).toBe(source.lastIndexOf(at) + 1);
    });

    rule('destruct.nest-positional').it(
      'keeps RILL-P001 for a nested destruct as a dict value',
      () => {
        expect(
          parseError('dict[a: 1] -> destruct<a: destruct<$b>>').errorId
        ).toBe('RILL-P001');
      }
    );

    it.each([
      'list[1, 2] -> destruct<$a, _>',
      'dict[a: 1, b: 2] -> destruct<a: $x, b: $y>',
      'list[1] -> destruct<>',
    ])('parses uniform pattern %s', (source) => {
      expect(() => parse(source)).not.toThrow();
    });
  });

  describe('destruct<> evaluation', () => {
    it('destruct<$a, $b> binds first two elements (AC-7)', async () => {
      const { context } = await runWithContext(
        'list[10, 20, 30] => $data\n$data -> destruct<$a, $b, $c>'
      );
      expect(context.variables.get('a')).toBe(10);
      expect(context.variables.get('b')).toBe(20);
      expect(context.variables.get('c')).toBe(30);
    });

    rule('destruct.skip').it(
      'destruct<$a, _, $c> skips the second element (AC-10)',
      async () => {
        const { context } = await runWithContext(
          'list[10, 20, 30] => $data\n$data -> destruct<$a, _, $c>'
        );
        expect(context.variables.get('a')).toBe(10);
        expect(context.variables.get('c')).toBe(30);
        expect(context.variables.has('_')).toBe(false);
      }
    );

    rule('destruct.result').it(
      'destruct returns original input unchanged',
      async () => {
        const result = await run(
          'list[1, 2, 3] => $data\n$data -> destruct<$a, $b, $c>'
        );
        expect(result).toEqual([1, 2, 3]);
      }
    );

    it('destruct<_> with only skip target is valid (AC-43)', async () => {
      const result = await run('list[42] => $data\n$data -> destruct<_>');
      expect(result).toEqual([42]);
    });
  });
});

describe('destruct<> and slice<> reference rules', () => {
  rule('destruct.target').it(
    'rejects destruct at the head of a statement with RILL-P001',
    async () => {
      await expect(run('destruct<$a, $b>')).rejects.toMatchObject({
        errorId: 'RILL-P001',
      });
      const { context } = await runWithContext(
        'list[1, 2] -> destruct<$a, $b>'
      );
      expect(context.variables.get('b')).toBe(2);
    }
  );

  rule('destruct.positional-source', 'destruct.length').it(
    'matches destruct<> only against an empty list or tuple',
    async () => {
      expect(await run('list[] -> destruct<>')).toEqual([]);
      expect(await run('tuple[] -> destruct<> -> .len')).toBe(0);
      await expectHalt(() => run('list[1] -> destruct<>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
      });
      await expectHalt(() => run('"s" -> destruct<$a>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got string',
      });
    }
  );

  rule('destruct.nested').it(
    'destructures each nested pattern by the same rules',
    async () => {
      expect(
        await run(
          'list[list[1, 2], list[3, 4]] -> destruct<destruct<$a, $b>, destruct<$c, $d>>\nlist[$a, $b, $c, $d]'
        )
      ).toEqual([1, 2, 3, 4]);
      await expectHalt(
        () => run('list[list[1, 2]] -> destruct<destruct<$a>>'),
        {
          code: 'RILL_R002',
          hostErrorId: 'RILL-R002',
        }
      );
    }
  );

  rule('destruct.keyed-source').it(
    'binds a subset of keys and rejects a non-keyed source naming its kind',
    async () => {
      expect(await run('dict[a: 1, b: 2] -> destruct<b: $x>\n$x')).toBe(2);
      expect(await run('ordered[a: 1, b: 2] -> destruct<b: $x>\n$x')).toBe(2);
      await expectHalt(() => run('list[1, 2] -> destruct<k: $v>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got list',
      });
      await expectHalt(() => run('"s" -> destruct<k: $v>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got string',
      });
    }
  );

  rule('destruct.missing-field').it(
    'halts RILL-R009 on a key the dict or ordered lacks',
    async () => {
      await expectHalt(() => run('dict[a: 1] -> destruct<b: $x>'), {
        code: 'RILL_R009',
        hostErrorId: 'RILL-R009',
        messagePattern: 'Undefined dict key: b',
      });
      await expectHalt(() => run('ordered[a: 1] -> destruct<b: $x>'), {
        code: 'RILL_R009',
        hostErrorId: 'RILL-R009',
        messagePattern: 'Undefined ordered key: b',
      });
    }
  );

  rule('destruct.bind').it(
    'binds each element as a capture, with rebinding, type lock, and scope',
    async () => {
      expect(await run('1 => $a\nlist[2] -> destruct<$a>\n$a')).toBe(2);
      await expectHalt(() => run('1 => $a\nlist["x"] -> destruct<$a>'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
      await expectHalt(() => run('list[1] -> { $ -> destruct<$a> }\n$a'), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
      });
    }
  );

  rule('destruct.typed').it(
    'halts RILL-R001 when an unannotated element breaks an existing type lock',
    async () => {
      await expectHalt(() => run('1 => $a\nlist["x"] -> destruct<$a>'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
      await expectHalt(() => run('list[1] -> destruct<$a:string>'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('slice.separator').it(
    'rejects slice<> and a slice with no colon with RILL-P001',
    async () => {
      await expect(run('list[1, 2] -> slice<>')).rejects.toMatchObject({
        errorId: 'RILL-P001',
      });
      await expect(run('list[1, 2] -> slice<1>')).rejects.toMatchObject({
        errorId: 'RILL-P001',
      });
    }
  );

  rule('slice.bound-form').it(
    'accepts number, variable, and grouped bounds and rejects a string bound',
    async () => {
      expect(
        await run('1 => $s\nlist[0, 1, 2, 3] -> slice<$s:(1 + 2)>')
      ).toEqual([1, 2]);
      await expect(run('list[1, 2] -> slice<"a":>')).rejects.toMatchObject({
        errorId: 'RILL-P001',
      });
    }
  );

  rule('slice.sources').it(
    'slices a list, tuple, or string and rejects other sources naming the kind',
    async () => {
      expect(await run('list[0, 1, 2] -> slice<0:2>')).toEqual([0, 1]);
      expect(
        await run('tuple[0, 1, 2] -> slice<0:2> -> { $ == tuple[0, 1] }')
      ).toBe(true);
      expect(await run('"héllo" -> slice<1:3>')).toBe('él');
      await expectHalt(() => run('range(0, 3) -> slice<0:1>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got iterator',
      });
      await expectHalt(() => run('dict[a: 1] -> slice<0:1>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
        messagePattern: 'got dict',
      });
    }
  );

  rule('slice.defaults').it(
    'defaults start and stop to the last index and before the first for a negative step',
    async () => {
      expect(await run('list[0, 1, 2, 3, 4] -> slice<:1:-1>')).toEqual([
        4, 3, 2,
      ]);
      expect(await run('list[0, 1, 2, 3, 4] -> slice<2::-1>')).toEqual([
        2, 1, 0,
      ]);
    }
  );

  rule('slice.clamp').it('clamps a bound past either end', async () => {
    expect(await run('list[0, 1, 2] -> slice<1:100>')).toEqual([1, 2]);
    expect(await run('list[0, 1, 2] -> slice<-100:2>')).toEqual([0, 1]);
    expect(await run('list[0, 1, 2] -> slice<100:-100:-1>')).toEqual([2, 1, 0]);
  });

  rule('slice.empty-result').it(
    'yields an empty list, tuple, or string when nothing is selected',
    async () => {
      expect(await run('list[0, 1, 2] -> slice<5:9>')).toEqual([]);
      expect(await run('tuple[0, 1] -> slice<5:9> -> { $ == tuple[] }')).toBe(
        true
      );
      expect(await run('"abc" -> slice<2:1>')).toBe('');
    }
  );

  rule('slice.integer').it(
    'halts #INVALID_INPUT on a non-integer bound and RILL-R002 on a non-number bound',
    async () => {
      await expectHalt(() => run('list[0, 1, 2] -> slice<0.5:2>'), {
        code: 'INVALID_INPUT',
      });
      await expectHalt(() => run('list[0, 1, 2] -> slice<0:2:1.5>'), {
        code: 'INVALID_INPUT',
      });
      await expectHalt(() => run('"x" => $s\nlist[0, 1, 2] -> slice<$s:2>'), {
        code: 'RILL_R002',
        hostErrorId: 'RILL-R002',
      });
    }
  );
});
