/**
 * Time-domain operators accept only streams and iterators; in-memory
 * collection sources such as tuples and ordereds halt with #INVALID_INPUT.
 */

import { describe, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const OPERATORS = ['debounce', 'throttle', 'sample'] as const;

describe('time-domain operators reject non-stream inputs', () => {
  for (const op of OPERATORS) {
    it(`${op} halts INVALID_INPUT on a tuple`, async () => {
      await expectHalt(
        () => run(`tuple[1, 2] -> ${op}(duration(0, 0, 0, 0, 0, 0, 1))`),
        {
          code: 'INVALID_INPUT',
        }
      );
    });

    it(`${op} halts INVALID_INPUT on an ordered`, async () => {
      await expectHalt(
        () => run(`ordered[a: 1] -> ${op}(duration(0, 0, 0, 0, 0, 0, 1))`),
        { code: 'INVALID_INPUT' }
      );
    });
  }
});
