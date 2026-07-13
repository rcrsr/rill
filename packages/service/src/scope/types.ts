/**
 * Scope data-model types for the rill language service.
 * These are plain-data shapes describing bindings, hover, and completion results.
 */

import type { SourceSpan } from '@rcrsr/rill';

import type { Range } from '../types.js';

// ============================================================
// BINDINGS
// ============================================================

/** The syntactic origin of a variable binding. */
export type BindingKind =
  | 'capture'
  | 'closureParam'
  | 'destructure'
  | 'dictKey';

/** A single variable binding resolved within a scope. */
export interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly declarationSpan: SourceSpan;
  readonly bindingSite: SourceSpan;
}

// ============================================================
// HOVER
// ============================================================

/** Hover information for a position in a rill document. */
export interface HoverInfo {
  readonly contents: string;
  readonly range?: Range | undefined;
  readonly type?: string | undefined;
}

// ============================================================
// COMPLETION
// ============================================================

/** The kind of a completion item. */
export type CompletionKind = 'variable' | 'function' | 'keyword';

/** A single completion suggestion. */
export interface CompletionItem {
  readonly label: string;
  readonly kind: CompletionKind;
  readonly detail?: string | undefined;
}
