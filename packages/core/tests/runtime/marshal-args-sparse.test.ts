/**
 * Rill Runtime Tests: marshalArgs with sparse (undefined) positional slots
 */

import { describe, expect, it } from 'vitest';
import {
  marshalArgs,
  RuntimeError,
  type MarshalOptions,
  type RillParam,
} from '@rcrsr/rill';

describe('marshalArgs sparse arguments', () => {
  const opts: MarshalOptions = {
    functionName: 'testFn',
    location: undefined,
  };

  it('hydrates the default when the positional slot is undefined', () => {
    const params: RillParam[] = [
      {
        name: 'x',
        type: { kind: 'number' },
        defaultValue: 7,
        annotations: {},
      },
    ];
    const result = marshalArgs([undefined], params, opts);
    expect(result).toEqual({ x: 7 });
  });

  it('raises RILL-R044 when an undefined slot has no default', () => {
    const params: RillParam[] = [
      {
        name: 'x',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: {},
      },
    ];
    let caught: unknown;
    try {
      marshalArgs([undefined], params, opts);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect(caught instanceof RuntimeError && caught.errorId).toBe('RILL-R044');
  });
});
