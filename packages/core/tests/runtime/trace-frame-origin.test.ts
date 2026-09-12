/**
 * Runtime tests: trace-frame kind reflects real halt origin (issue #431
 * part 1).
 *
 * `closures.ts` appends exactly one enrichment trace frame at each call
 * boundary it wraps (host-fn dispatch, script-callable invocation,
 * type-method dispatch, fallback-method dispatch). Before this fix every
 * one of those frames was hardcoded to `kind: 'host'`, even when the
 * boundary being crossed was a script-defined closure body rather than a
 * host/extension function. These tests exercise both boundary shapes
 * through `execute()` and assert the resulting frame kinds differ.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  parse,
  getStatus,
  isInvalid,
} from '@rcrsr/rill';

async function run(src: string): Promise<unknown> {
  const ctx = createRuntimeContext({});
  const { result } = await execute(parse(src), ctx);
  return result;
}

describe('trace-frame kind reflects real halt origin', () => {
  it('a halt escaping a host-registered function dispatch appends a `host`-kind frame', async () => {
    // `log()` with no arguments halts catchable inside invokeFnCallable's
    // native-function dispatch (a genuine host boundary).
    const result = await run('guard { log() }');
    expect(isInvalid(result as never)).toBe(true);
    const trace = getStatus(result as never).trace;
    const hostFrames = trace.filter((f) => f.kind === 'host');
    expect(hostFrames.length).toBeGreaterThanOrEqual(1);
    expect(trace[trace.length - 1]!.kind).toBe('guard-caught');
  });

  it('a halt escaping a script-defined closure body does not append a second `host` frame at the call boundary', async () => {
    const src = `
      |x| ($x.bogus) => $f
      guard { $f(dict[a: 1]) }
    `;
    const result = await run(src);
    expect(isInvalid(result as never)).toBe(true);
    const trace = getStatus(result as never).trace;

    // Origin frame: accessDictField's own halt (host — a genuine
    // runtime-authored field-access failure, not a call boundary).
    expect(trace[0]!.kind).toBe('host');
    expect(trace[0]!.fn).toBe('accessDictField');

    // The script-callable call boundary enriches with `access`, not
    // `host` — it is not a host/extension dispatch boundary.
    const callBoundaryFrame = trace.find(
      (f) => f.fn === 'invokeRegularScriptCallable'
    );
    expect(callBoundaryFrame).toBeDefined();
    expect(callBoundaryFrame!.kind).toBe('access');

    // Outer guard still catches and appends its own frame last.
    expect(trace[trace.length - 1]!.kind).toBe('guard-caught');
  });

  it('the two boundary shapes produce different trace-frame kinds for their respective call-boundary frame', async () => {
    const hostResult = await run('guard { log() }');
    const hostTrace = getStatus(hostResult as never).trace;
    expect(hostTrace.some((f) => f.kind === 'host')).toBe(true);

    const scriptSrc = `
      |x| ($x.bogus) => $f
      guard { $f(dict[a: 1]) }
    `;
    const scriptResult = await run(scriptSrc);
    const scriptTrace = getStatus(scriptResult as never).trace;
    const scriptBoundary = scriptTrace.find(
      (f) => f.fn === 'invokeRegularScriptCallable'
    );
    expect(scriptBoundary!.kind).not.toBe('host');
    expect(scriptBoundary!.kind).toBe('access');
  });
});
