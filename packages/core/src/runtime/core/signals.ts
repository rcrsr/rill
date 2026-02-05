/**
 * Control Flow Signals
 *
 * Signals thrown to unwind the call stack for control flow.
 * These are part of the public API for host applications that
 * need to catch and handle control flow.
 */

import type { RillValue } from './values.js';

/** Signal thrown by `break` to exit loops */
export class BreakSignal extends Error {
  constructor(public readonly value: RillValue) {
    super('break');
    this.name = 'BreakSignal';
  }
}

/** Signal thrown by `return` to exit blocks */
export class ReturnSignal extends Error {
  constructor(public readonly value: RillValue) {
    super('return');
    this.name = 'ReturnSignal';
  }
}
