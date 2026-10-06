/**
 * Test helpers for typed-atom halt assertions.
 *
 * A script halt throws `RuntimeHaltSignal` carrying an invalid `RillValue`;
 * the signal's `.message` is always `'runtime halt'` and the diagnostic
 * lives on the value's status sidecar (`status.code`, `status.message`).
 * At the host boundary a halt may instead surface as a `RuntimeError`
 * carrying the original invalid under `haltValue`. Exported helpers:
 *
 * - `expectHalt(exec, { code, messagePattern?, hostErrorId? })`: async;
 *   asserts a halt with the expected atom and optional message and host
 *   error id.
 * - `expectHaltMessage(exec, pattern)`: async; asserts only the halt message.
 * - `expectRuntimeError(exec, { code, messagePattern? })`: async; asserts a
 *   plain `RuntimeError` (no `haltValue`) with the given hyphen-form id.
 * - `expectThrowMessage(exec, pattern, errorClass?)`: async; asserts a host
 *   `Error` that is neither a halt nor a `RuntimeError`, optionally of a
 *   given class.
 * - `expectHaltMessageSync(exec, pattern)`: sync form of `expectHaltMessage`.
 * - `expectHaltSync(exec, { code, messagePattern? })`: sync form of
 *   `expectHalt`.
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
  /**
   * Optional hyphen-form host error id (e.g. `'RILL-R059'`). Honored only by
   * `expectHalt`: when set, the halt must be a `RuntimeError` rematerialised
   * at the host boundary (carrying `haltValue`) with this `errorId`; a raw
   * `RuntimeHaltSignal` or a non-halt `RuntimeError` fails.
   */
  hostErrorId?: string | undefined;
}

/** Matches `actual` against a regex, or as a substring for strings. */
function matchMessage(actual: string, pattern: RegExp | string): void {
  if (pattern instanceof RegExp) {
    expect(actual).toMatch(pattern);
  } else {
    expect(actual).toContain(pattern);
  }
}

/** Fails when `code` is unregistered and `resolveAtom` fell back to `#R001`. */
function assertAtomRegistered(code: string): void {
  if (code !== 'R001' && resolveAtom(code) === resolveAtom('R001')) {
    throw new Error(
      `expectHalt: atom '${code}' is not registered in CORE_ATOM_REGISTRATIONS — resolveAtom returned the #R001 fallback. Register the atom or check the code name.`
    );
  }
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
  if (expected.hostErrorId !== undefined) {
    expect(caught).toBeInstanceOf(RuntimeError);
    const hostError = caught as RuntimeError;
    expect(hostError.haltValue).toBeDefined();
    expect(hostError.errorId).toBe(expected.hostErrorId);
  }
  const status = getStatus(extractHaltInvalid(caught));
  assertAtomRegistered(expected.code);
  expect(status.code).toBe(resolveAtom(expected.code));
  if (expected.messagePattern !== undefined) {
    matchMessage(status.message, expected.messagePattern);
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
  matchMessage(status.message, pattern);
}

/**
 * Asserts that `exec` rejects with a `RuntimeError` that is NOT a
 * rematerialised halt (no `haltValue`), with the expected hyphen-form
 * `errorId` (e.g. `'RILL-R059'`) and, optionally, a matching message
 * (substring for strings).
 */
export async function expectRuntimeError(
  exec: () => Promise<unknown>,
  expected: { code: string; messagePattern?: RegExp | string }
): Promise<void> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RuntimeError);
  const error = caught as RuntimeError;
  expect(error.haltValue).toBeUndefined();
  expect(error.errorId).toBe(expected.code);
  if (expected.messagePattern !== undefined) {
    matchMessage(error.message, expected.messagePattern);
  }
}

/**
 * Asserts that `exec` rejects with a host `Error` (for example a
 * `ParseError`) that is neither a halt nor a `RuntimeError`, and whose
 * message matches `pattern`. When `errorClass` is given, the error must
 * also be an instance of it.
 */
export async function expectThrowMessage(
  exec: () => Promise<unknown>,
  pattern: RegExp | string,
  errorClass?: new (...args: never[]) => Error
): Promise<void> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(errorClass ?? Error);
  expect(caught).not.toBeInstanceOf(RuntimeHaltSignal);
  expect(caught).not.toBeInstanceOf(RuntimeError);
  const message = (caught as Error).message;
  matchMessage(message, pattern);
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
  matchMessage(status.message, pattern);
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
  assertAtomRegistered(expected.code);
  expect(status.code).toBe(resolveAtom(expected.code));
  if (expected.messagePattern !== undefined) {
    matchMessage(status.message, expected.messagePattern);
  }
}
