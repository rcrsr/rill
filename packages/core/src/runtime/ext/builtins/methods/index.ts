/**
 * Built-in Method Table Assembly
 *
 * Collects the 8 per-type method records into the single table the runtime
 * and the language service read.
 *
 * Key insertion order is observable, not incidental: get-hover.ts and
 * get-completions.ts in @rcrsr/rill-language-service iterate
 * `Object.values(BUILTIN_METHODS)`, so reordering these fields reorders
 * hover and completion output.
 *
 * @internal - Not part of public API
 */

import type { RillFunction } from '../../../core/callable.js';

import {
  STRING_METHODS,
  LIST_METHODS,
  DICT_METHODS,
  NUMBER_METHODS,
  BOOL_METHODS,
  VECTOR_METHODS,
  DATETIME_METHODS,
  DURATION_METHODS,
} from './tables.js';

export const BUILTIN_METHODS: {
  string: Record<string, RillFunction>;
  list: Record<string, RillFunction>;
  dict: Record<string, RillFunction>;
  number: Record<string, RillFunction>;
  bool: Record<string, RillFunction>;
  vector: Record<string, RillFunction>;
  datetime: Record<string, RillFunction>;
  duration: Record<string, RillFunction>;
} = {
  string: STRING_METHODS,
  list: LIST_METHODS,
  dict: DICT_METHODS,
  number: NUMBER_METHODS,
  bool: BOOL_METHODS,
  vector: VECTOR_METHODS,
  datetime: DATETIME_METHODS,
  duration: DURATION_METHODS,
};
