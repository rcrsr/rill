/**
 * Rill Runtime Tests: annotation access reads own keys only
 *
 * `$f.^key` looks the key up as an own property of the annotations, so
 * inherited Object.prototype members never leak out as annotation values.
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

describe('annotation own-key lookup', () => {
  it.each(['nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'halts with the missing-annotation halt for ^%s',
    async (key) => {
      await expectHalt(() => run(`|x|($x) => $f\n$f.^${key}`), {
        code: 'RILL_R008',
        messagePattern: `Annotation '${key}' not found`,
      });
    }
  );

  it.each(['constructor', '__proto__'])(
    'reads an own annotation key named %s',
    async (key) => {
      expect(await run(`^(${key}: "x") |x|($x) => $f\n$f.^${key}`)).toBe('x');
    }
  );
});
