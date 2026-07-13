/**
 * Root data-model types for the rill language service.
 * These are plain-data shapes with no dependency on any LSP library.
 */

import type { HighlightCategory } from '@rcrsr/rill';

// ============================================================
// POSITION AND RANGE
// ============================================================

/** A 0-based line/character position, matching LSP convention. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** A 0-based span between two positions. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

// ============================================================
// DOCUMENT SYMBOLS
// ============================================================

/** The kind of a document symbol. */
export type SymbolKind = 'variable' | 'function' | 'field';

/** A named, ranged symbol extracted from a rill document. */
export interface DocumentSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  /** Full symbol span, 0-based. */
  readonly range: Range;
  /** Name-token span. */
  readonly selectionRange: Range;
  readonly children?: DocumentSymbol[] | undefined;
}

// ============================================================
// SEMANTIC TOKENS
// ============================================================

/** Token classification for semantic highlighting. Extends core's HighlightCategory with a type-name heuristic. */
export type ServiceTokenType = HighlightCategory | 'typeName';

/** A single semantic token using LSP relative encoding. */
export interface SemanticToken {
  readonly deltaLine: number;
  readonly deltaStart: number;
  readonly length: number;
  readonly tokenType: ServiceTokenType;
  /** Bitset of token modifiers; 0 when none. */
  readonly tokenModifiers: number;
}

// ============================================================
// TEXT EDITS
// ============================================================

/** A single text replacement over a range. */
export interface TextEdit {
  readonly range: Range;
  readonly newText: string;
}
