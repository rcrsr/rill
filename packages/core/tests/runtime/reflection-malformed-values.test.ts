/**
 * Reflection over host function values and malformed callables must not leak
 * function source text and must surface rill halts, never raw host errors.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createRillStream,
  formatValue,
  getStatus,
  inferStructure,
  RuntimeError,
  RuntimeHaltSignal,
  structureMatches,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

const SENTINEL = 'SENTINEL_FUNCTION_SOURCE_MARKER';
/** Appears only in the source of the stream's internal resolve wrapper. */
const WRAPPER_SOURCE_MARKER = 'cachedResolution';

function expectNoFunctionSource(output: string): void {
  expect(output).not.toContain(SENTINEL);
  expect(output).not.toContain(WRAPPER_SOURCE_MARKER);
}

function makeLeakyStream(): RillFunction {
  return {
    params: [],
    returnType: anyTypeValue,
    fn: () =>
      createRillStream({
        chunks: (async function* () {
          yield 1;
        })(),
        resolve: async () => {
          const marker = 'SENTINEL_FUNCTION_SOURCE_MARKER';
          return marker.length > 0 ? null : null;
        },
      }),
  };
}

/** A callable with no returnType, which a well-formed host never produces. */
function makeMalformedCallable(): RillValue {
  return {
    __type: 'callable',
    kind: 'application',
    fn: () => 1,
    params: [],
  } as unknown as RillValue;
}

const FUNCTIONS: Record<string, RillFunction> = {
  make_stream: makeLeakyStream(),
  make_bad: {
    params: [],
    returnType: anyTypeValue,
    fn: () => makeMalformedCallable(),
  },
};

function describeHalt(caught: unknown): string {
  if (caught instanceof RuntimeHaltSignal) {
    return getStatus(caught.value).message;
  }
  if (caught instanceof RuntimeError) {
    return caught.haltValue !== undefined
      ? `${caught.message} ${getStatus(caught.haltValue).message}`
      : caught.message;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/** Runs a script and returns everything it printed, returned, or halted with. */
async function collectOutput(source: string): Promise<string> {
  try {
    const result = await run(source, { functions: FUNCTIONS });
    return typeof result === 'function'
      ? String(result)
      : (JSON.stringify(result) ?? '');
  } catch (caught) {
    return describeHalt(caught);
  }
}

describe('function source never reaches script-visible output', () => {
  const GET_FN = 'make_stream() => $s\n$s.("__rill_stream_resolve") => $f\n';

  it('omits function source when interpolating a host function', async () => {
    expectNoFunctionSource(await collectOutput(`${GET_FN}"{$f}"`));
  });

  it('omits function source from the halt raised by reflecting a host function', async () => {
    expectNoFunctionSource(await collectOutput(`${GET_FN}$f.^type.name`));
  });

  it('omits function source from a caught halt message', async () => {
    expectNoFunctionSource(
      await collectOutput(`${GET_FN}guard { $f.^type.name } => $r\n$r.!message`)
    );
  });

  it('omits function source from formatValue and inferStructure on a raw function', () => {
    const fn = (() => {
      const marker = 'SENTINEL_FUNCTION_SOURCE_MARKER';
      return marker;
    }) as unknown as RillValue;
    let formatted: string;
    try {
      formatted = formatValue(fn);
    } catch (caught) {
      formatted = describeHalt(caught);
    }
    let inferred: string;
    try {
      inferred = JSON.stringify(inferStructure(fn));
    } catch (caught) {
      inferred = describeHalt(caught);
    }
    expect(formatted).not.toContain(SENTINEL);
    expect(inferred).not.toContain(SENTINEL);
  });
});

describe('malformed callables halt instead of crashing', () => {
  it('halts INVALID_INPUT when inferring the structure of a callable without a return type', async () => {
    await expectHalt(async () => inferStructure(makeMalformedCallable()), {
      code: 'INVALID_INPUT',
    });
  });

  it('reports no structural match for a callable without a return type', () => {
    expect(
      structureMatches(makeMalformedCallable(), {
        kind: 'closure',
        params: [],
      })
    ).toBe(false);
  });

  it('rejects reflecting a callable without a return type with a halt, not a TypeError', async () => {
    let caught: unknown;
    try {
      await run('make_bad() => $f\n$f.^type', { functions: FUNCTIONS });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(TypeError);
    const isHalt =
      caught instanceof RuntimeHaltSignal || caught instanceof RuntimeError;
    expect(isHalt).toBe(true);
  });
});
