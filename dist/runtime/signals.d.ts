/**
 * Control Flow Signals
 *
 * Signals thrown to unwind the call stack for control flow.
 * These are part of the public API for host applications that
 * need to catch and handle control flow.
 */
import type { RillValue } from './values.js';
/** Signal thrown by `break` to exit loops */
export declare class BreakSignal extends Error {
    readonly value: RillValue;
    constructor(value: RillValue);
}
/** Signal thrown by `return` to exit blocks */
export declare class ReturnSignal extends Error {
    readonly value: RillValue;
    constructor(value: RillValue);
}
//# sourceMappingURL=signals.d.ts.map