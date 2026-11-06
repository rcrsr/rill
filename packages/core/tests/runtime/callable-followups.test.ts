/**
 * Rill Runtime Tests: callable follow-ups
 *
 * Public surface and registry text left after the untyped callable form
 * was retired.
 */

import { describe, expect, it } from 'vitest';
import * as rill from '@rcrsr/rill';
import {
  createRuntimeContext,
  createTestContext,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import { expectHalt, expectHaltSync } from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';
import { ERROR_REGISTRY } from '../../src/error-registry.js';

describe('Rill Runtime: callable follow-ups', () => {
  it('does not export the never-constructed runtime callable guard', () => {
    expect('isRuntimeCallable' in rill).toBe(false);
  });

  it('describes RILL-R085 with one template that both emitters fill', async () => {
    const template = ERROR_REGISTRY.get('RILL-R085')?.messageTemplate;
    expect(template).toBe("Host function '{functionName}' {detail}");
    const prefix = /^Host function '[^']+' /;

    const undeclared = {
      __type: 'callable',
      kind: 'application',
      isProperty: false,
      fn: () => 'x',
    } as unknown as RillValue;
    await expectHalt(() => run('$f(1)', { variables: { f: undeclared } }), {
      code: 'RILL_R085',
      messagePattern: new RegExp(
        `${prefix.source}has no parameter declaration`
      ),
    });

    await expectHalt(
      () =>
        run('bad()', {
          functions: {
            bad: { params: [], fn: () => {}, annotations: {} },
          } as unknown as Record<string, RillFunction>,
        }),
      {
        code: 'RILL_R085',
        messagePattern: new RegExp(`${prefix.source}returned an invalid value`),
      }
    );
  });

  it('halts RILL-R085 for a forged callable that has no fn and no params', async () => {
    const forged = {
      __type: 'callable',
      kind: 'application',
    } as unknown as RillValue;
    await expectHalt(() => run('$f.params', { variables: { f: forged } }), {
      code: 'RILL_R085',
      messagePattern:
        /Host function '<anonymous>' has no parameter declaration/,
    });
  });

  it.each([
    ['null', null],
    ['a number', 7],
    ['a string', 'x'],
  ])('halts RILL-R085 when params holds %s', async (_label, element) => {
    const forged = {
      __type: 'callable',
      kind: 'application',
      isProperty: false,
      fn: () => 'x',
      params: [element],
    } as unknown as RillValue;
    await expectHalt(() => run('$f(1)', { variables: { f: forged } }), {
      code: 'RILL_R085',
      messagePattern: /malformed parameter at index 0/,
    });
  });

  it('throws RuntimeError RILL-R085 from createRuntimeContext when a params entry is null', () => {
    const bad = {
      fn: () => 'x',
      params: [null],
      annotations: {},
    } as unknown as RillFunction;
    expect(() => createRuntimeContext({ functions: { bad } })).toThrow(
      expect.objectContaining({ errorId: 'RILL-R085' })
    );
  });

  it('halts RILL-R085 when createTestContext receives a params-less callable', () => {
    const undeclared = {
      __type: 'callable',
      kind: 'application',
      isProperty: false,
      fn: () => 'x',
    } as unknown as RillValue;
    expectHaltSync(() => createTestContext({ f: { value: undeclared } }), {
      code: 'RILL_R085',
      messagePattern: /toCallable or callable\(\)/,
    });
  });
});
