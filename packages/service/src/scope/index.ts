/**
 * Scope Module
 * Exports scope resolution, go-to-definition, hover, and completion providers.
 */

// ============================================================
// SCOPE PROVIDERS
// ============================================================
export { resolveScopeAt } from './resolve-scope.js';
export { findDefinition } from './find-definition.js';
export { getHover } from './get-hover.js';
export { getCompletions } from './get-completions.js';

// ============================================================
// SCOPE TYPES
// ============================================================
export type {
  Binding,
  BindingKind,
  HoverInfo,
  CompletionItem,
  CompletionKind,
} from './types.js';
