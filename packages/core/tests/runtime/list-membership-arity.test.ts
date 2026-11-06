/**
 * List membership methods validate arguments through marshalArgs, so scripts
 * see the registry error codes for missing, extra, and mistyped arguments.
 */

import { describe, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectRuntimeError } from '../helpers/halt.js';

describe('list membership method argument errors', () => {
  it.each([
    ['.has()', 'RILL-R044', /Missing argument for parameter 'value'/],
    ['.has(1, 2)', 'RILL-R045', /expects \d+ arguments, got \d+/],
    ['.has_any()', 'RILL-R044', /'candidates'/],
    ['.has_any(1)', 'RILL-R001', /candidates expects list/],
    ['.has_all()', 'RILL-R044', /'candidates'/],
    ['.has_all(1)', 'RILL-R001', /candidates expects list/],
  ] as const)(
    'raises %s with the registry error code seen by scripts',
    async (call, code, messagePattern) => {
      await expectRuntimeError(() => run(`list[1, 2, 3] -> ${call}`), {
        code,
        messagePattern,
      });
    }
  );
});
