/**
 * List membership methods validate arguments through marshalArgs, so scripts
 * see the registry error codes for missing, extra, and mistyped arguments.
 */

import { describe, it } from 'vitest';
import { BUILTIN_METHODS, createRuntimeContext } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHaltSync, expectRuntimeError } from '../helpers/halt.js';

describe('list membership method argument errors', () => {
  it.each([
    ['.has()', 'RILL-R044', /Missing argument for parameter 'value'/],
    ['.has(1, 2)', 'RILL-R045', /Function expects 1 argument, got 2/],
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

describe('list membership direct calls', () => {
  it.each(['has_any', 'has_all'] as const)(
    'halts %s with RILL-R001 when candidates is not a list',
    (name) => {
      const ctx = createRuntimeContext({});
      const method = BUILTIN_METHODS.list[name];
      expectHaltSync(
        () => method!.fn({ receiver: [1, 2, 3], candidates: 5 }, ctx),
        { code: 'RILL_R001', messagePattern: /candidates expects list/ }
      );
    }
  );

  it.each(['has_any', 'has_all'] as const)(
    'names a missing candidates argument as nothing in %s',
    (name) => {
      const ctx = createRuntimeContext({});
      const method = BUILTIN_METHODS.list[name];
      expectHaltSync(
        () => method!.fn({ receiver: [1], candidates: null }, ctx),
        {
          code: 'RILL_R001',
          messagePattern: /candidates expects list, got nothing/,
        }
      );
      expectHaltSync(() => method!.fn({ receiver: [1] }, ctx), {
        code: 'RILL_R001',
        messagePattern: /candidates expects list, got nothing/,
      });
    }
  );
});
