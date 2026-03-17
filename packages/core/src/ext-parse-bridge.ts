/**
 * Bridge for runtime/ext modules that need parse().
 *
 * Import boundary note (§NOD.2.1):
 * - This file lives at src/ level (not in runtime/), so it may import
 *   from the parser barrel.
 * - runtime/ext/test-context.ts imports from this file
 *   (../../ext-parse-bridge.js), which is NOT in parser/* — boundary preserved.
 */
export { parse as parseSource } from './parser/index.js';
