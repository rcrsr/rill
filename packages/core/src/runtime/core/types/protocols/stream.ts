/**
 * Stream Protocol Module
 *
 * TypeDefinition for the 'stream' built-in type.
 * Allowed imports: ../structures.js, ../guards.js, ./shared.js,
 * ../operations.js, ../callable.js, ../constructors.js, ../../../types.js
 *
 * MUST NOT import from ../registrations.js or sibling protocols/*.
 */

import type { RillValue, TypeStructure } from '../structures.js';
import type { TypeDefinition } from './types.js';
import { isStream } from '../guards.js';
import { throwNotSerializable } from './shared.js';

// ============================================================
// FORMAT
// ============================================================

function formatStream(_v: RillValue): string {
  return 'type(stream)';
}

// ============================================================
// STRUCTURE
// ============================================================

function streamStructure(v: RillValue): TypeStructure {
  const raw = v as unknown as Record<string, TypeStructure | undefined>;
  const chunk = raw['__rill_stream_chunk_type'];
  const ret = raw['__rill_stream_ret_type'];
  const result: {
    kind: 'stream';
    chunk?: TypeStructure;
    ret?: TypeStructure;
  } = { kind: 'stream' };
  if (chunk !== undefined) result.chunk = chunk;
  if (ret !== undefined) result.ret = ret;
  return result;
}

// ============================================================
// CONVERT-TO
// ============================================================

const streamConvertTo: Record<string, (v: RillValue) => RillValue> = {
  string: (_v: RillValue): RillValue => 'type(stream)',
};

// ============================================================
// TYPE DEFINITION
// ============================================================

export const streamType: TypeDefinition = {
  name: 'stream',
  identity: (v: RillValue): boolean => isStream(v),
  isLeaf: false,
  immutable: true,
  methods: {},
  protocol: {
    format: formatStream,
    structure: streamStructure,
    convertTo: streamConvertTo,
    serialize: throwNotSerializable('stream'),
  },
};
