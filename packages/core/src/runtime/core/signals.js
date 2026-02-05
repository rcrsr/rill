/**
 * Control Flow Signals
 *
 * Signals thrown to unwind the call stack for control flow.
 * These are part of the public API for host applications that
 * need to catch and handle control flow.
 */
/** Signal thrown by `break` to exit loops */
export class BreakSignal extends Error {
    value;
    constructor(value) {
        super('break');
        this.value = value;
        this.name = 'BreakSignal';
    }
}
/** Signal thrown by `return` to exit blocks */
export class ReturnSignal extends Error {
    value;
    constructor(value) {
        super('return');
        this.value = value;
        this.name = 'ReturnSignal';
    }
}
//# sourceMappingURL=signals.js.map