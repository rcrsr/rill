/**
 * Rill Runtime Tests: callable follow-ups
 *
 * Public surface and registry text left after the untyped callable form
 * was retired.
 */

import { describe, expect, it } from 'vitest';
import * as rill from '@rcrsr/rill';
import { createTestContext, type RillValue } from '@rcrsr/rill';
import { expectHaltSync } from '../helpers/halt.js';
import { ERROR_REGISTRY } from '../../src/error-registry.js';

describe('Rill Runtime: callable follow-ups', () => {
  it('does not export the never-constructed runtime callable guard', () => {
    expect('isRuntimeCallable' in rill).toBe(false);
  });

  it('describes RILL-R085 with a single message template', () => {
    expect(ERROR_REGISTRY.get('RILL-R085')?.messageTemplate).toBe(
      "Host callable '{functionName}' broke the host contract: {detail}"
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
