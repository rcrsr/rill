/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language: the fn literal.
 *
 * A function type written in front of a block makes a function. `fn { body }`
 * is typed by the unnamed params its body reads. A `fn()` body reads no
 * param. The `|params| body` literal and its paren and bare bodies are
 * removed.
 */

import { describe, expect, it } from 'vitest';
import { isCallable, parse, ParseError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

/** Parses `source` and returns the ParseError it raises, failing when it parses. */
function parseError(source: string): ParseError {
  try {
    parse(source);
  } catch (err) {
    if (err instanceof ParseError) return err;
    throw err;
  }
  throw new Error(`expected a ParseError for: ${source}`);
}

describe('Rill Language: fn literal', () => {
  describe('typed literal', () => {
    rule('fn.value').it(
      'evaluates fn(x: number):string { body } to a function of that type',
      async () => {
        const script = `
          fn(x: number):string { "{$x}" } => $g
          fn(x: number):string => $t
          $g.^type == $t
        `;
        expect(await run(script)).toBe(true);
      }
    );

    rule('fn.value').it('yields a callable that runs its block', async () => {
      const result = await run('fn(x: number):string { "{$x}" }');
      expect(isCallable(result)).toBe(true);
      expect(await run('fn(x: number):string { "{$x}" } => $g\n$g(4)')).toBe(
        '4'
      );
    });

    rule('fn.value').it(
      'asserts the outer against the result of each call',
      async () => {
        const script = 'fn(x: number):string { $x } => $g\n$g(4)';
        await expectHalt(() => run(script), { code: 'TYPE_MISMATCH' });
      }
    );

    rule('fn.value').it(
      'accepts a block body on the same line as the type',
      async () => {
        expect(await run('fn(x: number) { $x * 2 } => $g\n$g(4)')).toBe(8);
      }
    );
  });

  describe('bare literal', () => {
    rule('fn.bare-literal').it(
      'binds a function of type fn():any for a body that reads nothing',
      async () => {
        expect(await run('fn { 5 } => $x\n$x.^type == fn():any')).toBe(true);
      }
    );

    rule('fn.bare-literal').it(
      'types the function by the unnamed params its body reads',
      async () => {
        expect(await run('fn { $ * 2 } => $f\n$f.^type == fn(any):any')).toBe(
          true
        );
        expect(
          await run('fn { $ + $@ } => $f\n$f.^type == fn(any, any):any')
        ).toBe(true);
      }
    );

    rule('fn.bare-literal').it(
      'runs a body that reads the pipe value',
      async () => {
        expect(await run('5 -> fn { $ * 2 }')).toBe(10);
      }
    );

    rule('fn.bare-literal').it(
      'accepts fn:T { body } and takes its outer from T',
      async () => {
        expect(
          await run('fn:number { 5 } => $x\n$x.^type == fn():number')
        ).toBe(true);
      }
    );
  });

  describe('fn() body', () => {
    rule('fn.no-self').it('rejects a body that reads $ with RILL-P029', () => {
      expect(parseError('fn() { $ }').errorId).toBe('RILL-P029');
    });

    rule('fn.no-self').it('rejects a body that reads $@ with RILL-P029', () => {
      expect(parseError('fn() { $@ }').errorId).toBe('RILL-P029');
    });

    rule('fn.no-self').it(
      'rejects $ read through interpolation with RILL-P029',
      () => {
        expect(parseError('fn() { "got {$}" }').errorId).toBe('RILL-P029');
      }
    );

    rule('fn.no-self').it(
      'rejects an implicit $ receiver with RILL-P029',
      () => {
        expect(parseError('fn() { .trim }').errorId).toBe('RILL-P029');
      }
    );

    rule('fn.no-self').it(
      'rejects the read where the fn is written, not where it is called',
      () => {
        expect(parseError('fn() { $ + 1 } => $inc').errorId).toBe('RILL-P029');
      }
    );

    rule('fn.no-self').it(
      'accepts a body that reads a nested fn own $',
      async () => {
        expect(await run('fn() { fn { $ * 2 } } => $f\n$f()(4)')).toBe(8);
      }
    );

    rule('fn.no-self').it(
      'accepts a body that reads no unnamed param',
      async () => {
        expect(await run('fn() { 42 } => $f\n$f()')).toBe(42);
      }
    );
  });

  describe('annotations', () => {
    it('reads an annotation placed before a fn literal', async () => {
      const script = `
        ^(description: "doubles") fn(x: number) { $x * 2 } => $f
        $f.^description
      `;
      expect(await run(script)).toBe('doubles');
    });

    it('carries an annotation placed before a param of a fn literal', async () => {
      const script = `
        fn(^(description: "the input") x: number) { $x } => $f
        $f.^type
      `;
      const result = (await run(script)) as {
        structure: {
          params: { name: string; annotations?: Record<string, unknown> }[];
        };
      };
      expect(result.structure.params[0]!.annotations).toEqual({
        description: 'the input',
      });
    });

    it('carries an annotation placed before a param of a fn type', async () => {
      const result = (await run(
        'fn(^(description: "the input") x: number):number'
      )) as {
        structure: {
          params: { name: string; annotations?: Record<string, unknown> }[];
        };
      };
      expect(result.structure.params[0]!.annotations).toEqual({
        description: 'the input',
      });
    });
  });

  describe('removed forms', () => {
    it.each([
      ['a |params| literal with a block body', '|x| { $x }'],
      ['a |params| literal with a parenthesized body', '|x| ($x)'],
      ['a |params| literal with a bare body', '|x| $x'],
      ['a || literal with a block body', '|| { 1 }'],
      ['a || literal with a parenthesized body', '|| (1)'],
      ['a typed |params| literal', '|x: number| { $x }'],
      ['a |params|:R type literal', '|x: number|:string'],
      ['a || type literal', '||:string'],
    ])('rejects %s with RILL-P012 naming fn', (_label, source) => {
      const err = parseError(source);
      expect(err.errorId).toBe('RILL-P012');
      expect(err.message).toContain('fn');
    });

    it.each([
      ['a parenthesized body', 'fn(x: number) ($x)'],
      ['a bare body', 'fn(x: number) $x'],
    ])(
      'rejects a fn literal with %s with RILL-P012 naming braces',
      (_label, source) => {
        const err = parseError(source);
        expect(err.errorId).toBe('RILL-P012');
        expect(err.message).toContain('braces');
      }
    );

    it.each([
      ['a type name expression', 'closure'],
      ['an assertion target', '1 -> :closure'],
      ['a capture annotation', '1 => $x:closure'],
      ['a param type', 'fn(callback: closure) { $callback }'],
    ])(
      'rejects the closure type as %s with RILL-P012 naming fn',
      (_label, source) => {
        const err = parseError(source);
        expect(err.errorId).toBe('RILL-P012');
        expect(err.message).toContain('fn');
      }
    );
  });
});
