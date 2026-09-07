/**
 * Rill Language Tests: Closure Signature Literal Annotations
 *
 * Closure sig literals (`|param: type, ...| :returnType`) evaluate to type
 * values whose `structure.params` mirror the ordinary closure param
 * annotation syntax (`|^("label") x: string| { ... }`). This suite covers
 * the empty-param form, single- and multi-param annotation carriage, the
 * distinction between a closure sig literal (type value) and a closure
 * literal (callable value), and that annotations on a sig literal's params
 * are ignored by structural type matching.
 */

import { describe, expect, it } from 'vitest';
import { isCallable, isTypeValue } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

describe('Rill Language: Closure Sig Literal Annotations', () => {
  it('empty param list closure sig literal evaluates to a type value with zero params and string return', async () => {
    const result = await run('||:string');
    expect(isTypeValue(result)).toBe(true);
    if (!isTypeValue(result)) throw new Error('expected type value');
    expect(result.typeName).toBe('closure');
    const structure = result.structure as {
      kind: string;
      params: unknown[];
      ret: { kind: string };
    };
    expect(structure.kind).toBe('closure');
    expect(structure.params).toEqual([]);
    expect(structure.ret).toEqual({ kind: 'string' });
  });

  it('single annotated param: structure.params[0].annotations deep-equals { description: "label" }', async () => {
    const script = `
      |^("label") x: string| :number => $t
      $t
    `;
    const result = await run(script);
    expect(isTypeValue(result)).toBe(true);
    if (!isTypeValue(result)) throw new Error('expected type value');
    const structure = result.structure as {
      params: { name: string; annotations?: Record<string, unknown> }[];
    };
    expect(structure.params).toHaveLength(1);
    expect(structure.params[0]!.name).toBe('x');
    expect(structure.params[0]!.annotations).toEqual({
      description: 'label',
    });
  });

  it('multi-param: only the annotated param carries annotations', async () => {
    const script = `
      |^(description: "d") x: string, y: number| :bool => $t
      $t
    `;
    const result = await run(script);
    expect(isTypeValue(result)).toBe(true);
    if (!isTypeValue(result)) throw new Error('expected type value');
    const structure = result.structure as {
      params: { name: string; annotations?: Record<string, unknown> }[];
    };
    expect(structure.params).toHaveLength(2);
    expect(structure.params[0]!.name).toBe('x');
    expect(structure.params[0]!.annotations).toEqual({ description: 'd' });
    expect(structure.params[1]!.name).toBe('y');
    expect(structure.params[1]!.annotations).toBeUndefined();
  });

  it('a closure literal with a body remains a callable, not a type value', async () => {
    const result = await run('|x: number| { $x }');
    expect(isTypeValue(result)).toBe(false);
    expect(isCallable(result)).toBe(true);
  });

  it('a closure satisfies an annotated sig literal type — annotations do not affect matching', async () => {
    // The sig literal's param annotation ("label") has no counterpart on the
    // closure literal's param; structural matching compares name and type
    // only, so the assertion still succeeds.
    const script = `
      |^("label") x: string| :number => $t
      |x: string| { 1 }:number -> :$t
    `;
    const result = await run(script);
    expect(isCallable(result)).toBe(true);
  });
});
