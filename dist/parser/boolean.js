/**
 * Boolean Expression Parsing - Circular Dependency Helpers
 *
 * This module only contains setter functions for breaking circular dependencies.
 * Boolean/logical operators (&&, ||, !) are now part of the main expression grammar
 * in expressions.ts.
 */
// Forward declaration for grouped expression parsing
let parseGroupedFn;
export function setParseGrouped(fn) {
    parseGroupedFn = fn;
}
// Forward declaration - will be set to break circular dependency
let parseBlockFn;
export function setParseBlock(fn) {
    parseBlockFn = fn;
}
// Re-export for any code that might still use these
export { parseGroupedFn, parseBlockFn };
//# sourceMappingURL=boolean.js.map