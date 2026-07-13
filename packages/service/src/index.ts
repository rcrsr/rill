/**
 * Rill Language Service Module
 * Exports language service tooling for rill
 */

export { version } from './version.js';

// ============================================================
// ROOT PROVIDERS
// ============================================================
export { documentSymbols } from './document-symbols.js';
export { semanticTokens } from './semantic-tokens.js';
export { formatDocument } from './format-document.js';
export { spanToRange } from './span-to-range.js';

// ============================================================
// ROOT TYPES
// ============================================================
export type {
  Position,
  Range,
  DocumentSymbol,
  SymbolKind,
  SemanticToken,
  ServiceTokenType,
  TextEdit,
} from './types.js';
