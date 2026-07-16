// Backward-compatible re-export shim. The real implementation lives at
// ../handlers/access.ts. This file exists solely so protected test files
// under tests/language/ (which predate the eval/mixins -> eval/handlers
// rename) can resolve their existing deep import without modification.
export * from '../handlers/access.js';
