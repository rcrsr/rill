/**
 * Rill Runtime Tests: string-form halts
 *
 * A closure or iterator nested in a collection halts on string conversion
 * and interpolation, with the halt attributed to the converting site. Log
 * output and streams keep their formatted forms.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  callable,
  createRuntimeContext,
  execute,
  getStatus,
  parse,
  RuntimeError,
  RuntimeHaltSignal,
  type RillStream,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

async function haltFrom(script: string): Promise<RillValue> {
  try {
    await run(script);
  } catch (e) {
    if (e instanceof RuntimeError && e.haltValue !== undefined) {
      return e.haltValue;
    }
    if (e instanceof RuntimeHaltSignal) return e.value;
    throw e;
  }
  throw new Error('expected a halt');
}

describe('string-form halts', () => {
  it('attributes an interpolation halt to evaluateString', async () => {
    const signal = await haltFrom('||(1) => $f\n"{$f}"');
    expect(getStatus(signal).trace[0]?.fn).toBe('evaluateString');
  });

  it('attributes a conversion halt to convertType', async () => {
    const signal = await haltFrom('||(1) => $f\nlist[$f] -> string');
    expect(getStatus(signal).trace[0]?.fn).toBe('convertType');
  });

  it('logs a list holding a closure without halting', async () => {
    const logs: string[] = [];
    await run('||(1) => $f\nlog(list[$f])', {
      callbacks: {
        onLog: (m: string) => {
          logs.push(m);
        },
      },
    });
    expect(logs).toEqual(['list[type(closure)]']);
  });

  it('converts a list holding a stream to its string form', async () => {
    const stream: RillStream = {
      __rill_stream: true,
      done: false,
      value: 'x',
      next: callable(() => null),
    };
    const ctx = createRuntimeContext({
      functions: {
        make_stream: {
          returnType: anyTypeValue,
          params: [],
          fn: () => stream,
        },
      },
    });
    const { result } = await execute(
      parse('make_stream() => $s\nlist[$s] -> string'),
      ctx
    );
    expect(result).toBe('list[type(stream)]');
  });
});
