/**
 * Rill Runtime Tests: capture lock over host callables without a return type
 *
 * A host callable that declares no return type locks at capture without
 * halting, inside a collection or alone, and an over-deep type halts
 * catchably instead of surfacing a raw RangeError.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  parse,
  type RillValue,
} from '@rcrsr/rill';
import { expectHalt } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

const noReturnType = {
  __type: 'callable',
  kind: 'application',
  isProperty: false,
  params: [],
  returnType: undefined,
  fn: (): RillValue => 1,
} as unknown as RillValue;

describe('Rill Runtime: capture lock over host callables', () => {
  it('locks a host callable with no return type at top level without halting', async () => {
    const result = await run('$f => $g\n"locked"', {
      variables: { f: noReturnType },
    });
    expect(result).toBe('locked');
  });

  it('recaptures a host callable with no return type', async () => {
    const result = await run('$f => $g\n$f => $g\n"locked"', {
      variables: { f: noReturnType },
    });
    expect(result).toBe('locked');
  });

  it('captures a list holding a host callable and recaptures the same value', async () => {
    const result = await run('list[$f] => $l\n$l => $l\n$l -> .len', {
      variables: { f: noReturnType },
    });
    expect(result).toBe(1);
  });

  it('halts INVALID_INPUT for a type nested past the stack depth', async () => {
    // The parser caps nesting depth, so source text cannot reach the
    // converter overflow; splice a deep type into a parsed program instead.
    const program = parse('list[1] -> list(number)');
    const statement = program.statements[0];
    const pipe =
      statement?.type === 'Statement' &&
      statement.expression.type === 'PipeChain'
        ? statement.expression.pipes[0]
        : undefined;
    if (pipe?.type !== 'TypeConstructor') {
      throw new Error('expected a type constructor pipe');
    }
    let deep: { kind: 'static'; typeName: string; args?: unknown } = {
      kind: 'static',
      typeName: 'number',
    };
    for (let i = 0; i < 100000; i++) {
      deep = { kind: 'static', typeName: 'list', args: [{ value: deep }] };
    }
    Object.assign(pipe, { args: [{ value: deep }] });

    await expectHalt(() => execute(program, createRuntimeContext({})), {
      code: 'INVALID_INPUT',
      messagePattern: 'stack depth exceeded while resolving type',
    });
  });
});
