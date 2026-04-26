/**
 * Control Flow Signals
 *
 * Signals thrown to unwind the call stack for control flow.
 * These are part of the public API for host applications that
 * need to catch and handle control flow.
 */

import type { RillValue } from './types/structures.js';

/**
 * Abstract base for all control-flow signals.
 * Subclasses pass their name and message to the protected constructor.
 * Never instantiated directly.
 */
export abstract class ControlSignal extends Error {
  readonly value: RillValue;
  protected constructor(name: string, message: string, value: RillValue) {
    super(message);
    this.name = name;
    this.value = value;
  }
}

/** Signal thrown by `break` to exit loops */
export class BreakSignal extends ControlSignal {
  constructor(value: RillValue) {
    super('BreakSignal', 'break', value);
  }
}

/** Signal thrown by `return` to exit blocks */
export class ReturnSignal extends ControlSignal {
  constructor(value: RillValue) {
    super('ReturnSignal', 'return', value);
  }
}

/** Signal thrown when a stream yields a chunk value */
export class YieldSignal extends ControlSignal {
  constructor(value: RillValue) {
    super('YieldSignal', 'yield', value);
  }
}
