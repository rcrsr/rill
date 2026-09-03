/**
 * Runtime test: pass<async: true> body halts surface at dispose() time.
 *
 * A fire-and-forget `pass<async: true>` body is not awaited by any caller,
 * so a halt it throws was previously swallowed by trackInflight and the
 * Promise.allSettled in performDispose. Per docs/topic-collection-slicing.md
 * ("Without on_error: #IGNORE, a catchable halt in the async body surfaces
 * at disposal time"), such a halt must now be observable at dispose().
 *
 * Surfacing is via the log callbacks (onLog / onLogEvent), consistent with
 * the existing dispose-timeout warning path. dispose() still resolves.
 *
 * Cases:
 * 1. Catchable halt without on_error: #IGNORE  -> surfaces at dispose().
 * 2. Catchable halt with on_error: #IGNORE      -> SUPPRESSED, no surface.
 * 3. Non-catchable error/assert halt            -> never swallowed; surfaces.
 * 4. Clean async body                           -> nothing surfaced.
 * 5. Structured onLogEvent path                 -> receives async_body_halt.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext, execute, parse } from '@rcrsr/rill';

interface CapturedLogs {
  messages: string[];
  events: Array<Record<string, unknown>>;
}

/**
 * Run `src`, then dispose, capturing everything the log callbacks receive.
 * Only `onLog` is installed unless `withEvent` is set, so the fallback
 * string path is exercised by default.
 */
async function runAndDispose(
  src: string,
  withEvent = false
): Promise<CapturedLogs> {
  const captured: CapturedLogs = { messages: [], events: [] };
  const ctx = createRuntimeContext({
    callbacks: {
      onLog: (message: string) => {
        captured.messages.push(message);
      },
      ...(withEvent
        ? {
            onLogEvent: (event: Record<string, unknown>) => {
              captured.events.push(event);
            },
          }
        : {}),
    },
  });

  await execute(parse(src), ctx);
  // Let the fire-and-forget body settle; dispose() also awaits in-flight
  // work, so this is belt-and-suspenders for synchronously-throwing bodies.
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  await ctx.dispose();
  return captured;
}

describe('pass<async: true> body halt surfaces at dispose()', () => {
  it('surfaces a catchable halt (no on_error: #IGNORE) via onLog', async () => {
    // 1 / 0 is a catchable runtime halt. Fire-and-forget, nobody awaits it.
    const logs = await runAndDispose('"x" -> pass<async: true> { 1 / 0 }');
    expect(logs.messages.length).toBeGreaterThan(0);
    expect(
      logs.messages.some((m) => m.includes('pass<async> body halted'))
    ).toBe(true);
  });

  it('SUPPRESSES a catchable halt when on_error: #IGNORE is set', async () => {
    // The documented compose case: async + suppress. The halt must NOT surface.
    const logs = await runAndDispose(
      '"data" -> pass<async: true, on_error: #IGNORE> { 1 / 0 }'
    );
    expect(logs.messages).toEqual([]);
  });

  it('never swallows a non-catchable error halt; surfaces its message', async () => {
    // `error` produces a non-catchable halt. It must never be swallowed.
    const logs = await runAndDispose('pass<async: true> { error "boom" }');
    expect(logs.messages.length).toBeGreaterThan(0);
    // The surfaced description carries the original halt message.
    expect(logs.messages.some((m) => m.includes('boom'))).toBe(true);
  });

  it('surfaces nothing for a clean async body', async () => {
    const logs = await runAndDispose(
      '"ok" -> pass<async: true> { $ -> .upper }'
    );
    expect(logs.messages).toEqual([]);
    expect(logs.events).toEqual([]);
  });

  it('prefers the structured onLogEvent channel when installed', async () => {
    const logs = await runAndDispose(
      '"x" -> pass<async: true> { 1 / 0 }',
      /* withEvent */ true
    );
    // Structured path wins: onLogEvent receives the event, onLog is not used.
    expect(logs.messages).toEqual([]);
    expect(logs.events.length).toBeGreaterThan(0);
    expect(logs.events[0]).toMatchObject({
      event: 'async_body_halt',
      subsystem: 'runtime',
    });
  });

  it('dispose() still resolves despite a surfaced halt', async () => {
    const ctx = createRuntimeContext({});
    await execute(parse('pass<async: true> { error "boom" }'), ctx);
    await expect(ctx.dispose()).resolves.toBeUndefined();
  });

  it('pipe value flows downstream unchanged and immediately', async () => {
    // Fire-and-forget: the halting body does not affect the pipe result.
    const ctx = createRuntimeContext({});
    const outcome = await execute(
      parse('"done" -> pass<async: true> { error "boom" }'),
      ctx
    );
    expect(outcome.result).toBe('done');
    await ctx.dispose();
  });
});
