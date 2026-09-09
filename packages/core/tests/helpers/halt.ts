/**
 * Test helpers for Phase 4 typed-atom halt assertions.
 *
 * Migration context (FR-ERR-17): `RILL-R004` sites were converted to
 * specific atom halts (`#TYPE_MISMATCH`, `#INVALID_INPUT`, etc.). The
 * migrated sites now throw `RuntimeHaltSignal` carrying an invalid
 * `RillValue`; the signal's `.message` is always `'runtime halt'` and
 * the original diagnostic lives on `signal.value`'s status sidecar
 * (`raw.message`, `status.message`) or on the invalid value's
 * `.!message` when probed from Rill.
 *
 * These helpers factor the probe patterns used across the test sweep:
 *
 * - `expectHalt(exec, { code, messagePattern? })` resolves when `exec`
 *   throws a `RuntimeHaltSignal` whose invalid `.status.code` matches
 *   the expected atom; `messagePattern` (optional) matches against
 *   `status.message` (which derives from `raw.message`).
 * - `expectHaltMessage(exec, pattern)` matches just the message, for
 *   tests that previously asserted via `rejects.toThrow(/regex/)`.
 */

import { expect } from 'vitest';
import { RuntimeError, RuntimeHaltSignal, type RillValue } from '@rcrsr/rill';
import { getStatus } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';

interface HaltExpectation {
  /** Expected atom name (e.g. `'TYPE_MISMATCH'`, `'INVALID_INPUT'`). */
  code: string;
  /** Optional pattern (regex or substring) matched against status.message. */
  messagePattern?: RegExp | string;
}

/**
 * Extracts the invalid `RillValue` carried by a caught halt, whether it
 * escaped as a raw `RuntimeHaltSignal` (uncaught inside a nested call, or
 * an atom excluded from host-boundary conversion) or was rematerialised
 * into a `RuntimeError` at the host boundary (`convertHaltToRuntimeError`
 * in `execute.ts`, which attaches the original invalid under the
 * non-enumerable `haltValue` property). Both shapes carry the same status
 * sidecar, so callers can assert on `status.code` / `status.message`
 * without caring which shape the halt surfaced as.
 */
function extractHaltInvalid(caught: unknown): RillValue {
  if (caught instanceof RuntimeHaltSignal) {
    return caught.value;
  }
  if (caught instanceof RuntimeError && caught.haltValue !== undefined) {
    return caught.haltValue;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  throw new Error('unreachable: expect() above always throws');
}

/**
 * Asserts that `exec` throws a halt (a raw `RuntimeHaltSignal`, or a
 * `RuntimeError` rematerialised from one at the host boundary) whose
 * invalid value carries the expected atom code and (optionally) a
 * matching message.
 */
export async function expectHalt(
  exec: () => Promise<unknown>,
  expected: HaltExpectation
): Promise<void> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  const status = getStatus(extractHaltInvalid(caught));
  if (
    expected.code !== 'R001' &&
    resolveAtom(expected.code) === resolveAtom('R001')
  ) {
    throw new Error(
      `expectHalt: atom '${expected.code}' is not registered in CORE_ATOM_REGISTRATIONS — resolveAtom returned the #R001 fallback. Register the atom or check the code name.`
    );
  }
  expect(status.code).toBe(resolveAtom(expected.code));
  if (expected.messagePattern !== undefined) {
    if (expected.messagePattern instanceof RegExp) {
      expect(status.message).toMatch(expected.messagePattern);
    } else {
      expect(status.message).toContain(expected.messagePattern);
    }
  }
}

/**
 * Asserts that `exec` throws a halt (raw or rematerialised, see
 * `expectHalt`) whose invalid value's status message matches `pattern`.
 * Use when the original test asserted only on message content (e.g.
 * `rejects.toThrow(/expected string/)`).
 */
export async function expectHaltMessage(
  exec: () => Promise<unknown>,
  pattern: RegExp | string
): Promise<void> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  const status = getStatus(extractHaltInvalid(caught));
  if (pattern instanceof RegExp) {
    expect(status.message).toMatch(pattern);
  } else {
    expect(status.message).toContain(pattern);
  }
}

/**
 * Synchronous form of `expectHaltMessage` for cases where `exec` is a
 * synchronous throwing call (e.g. direct `deserializeValue(...)` from
 * host code). Accepts either a void-returning thunk or any sync call.
 */
export function expectHaltMessageSync(
  exec: () => unknown,
  pattern: RegExp | string
): void {
  let caught: unknown;
  try {
    exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  const signal = caught as RuntimeHaltSignal;
  const status = getStatus(signal.value);
  if (pattern instanceof RegExp) {
    expect(status.message).toMatch(pattern);
  } else {
    expect(status.message).toContain(pattern);
  }
}

/**
 * Synchronous code + optional message form.
 */
export function expectHaltSync(
  exec: () => unknown,
  expected: HaltExpectation
): void {
  let caught: unknown;
  try {
    exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RuntimeHaltSignal);
  const signal = caught as RuntimeHaltSignal;
  const status = getStatus(signal.value);
  if (
    expected.code !== 'R001' &&
    resolveAtom(expected.code) === resolveAtom('R001')
  ) {
    throw new Error(
      `expectHalt: atom '${expected.code}' is not registered in CORE_ATOM_REGISTRATIONS — resolveAtom returned the #R001 fallback. Register the atom or check the code name.`
    );
  }
  expect(status.code).toBe(resolveAtom(expected.code));
  if (expected.messagePattern !== undefined) {
    if (expected.messagePattern instanceof RegExp) {
      expect(status.message).toMatch(expected.messagePattern);
    } else {
      expect(status.message).toContain(expected.messagePattern);
    }
  }
}
