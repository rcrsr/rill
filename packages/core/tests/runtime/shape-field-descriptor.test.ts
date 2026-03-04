/**
 * Runtime Tests: Shape Field Descriptor Mechanics
 *
 * Covers runtime dispatch items NOT tested in field-descriptor.test.ts:
 *
 * IR-2: .^key dispatch on field descriptors — reads spec.annotations[key]
 * IR-3: .keys on shape values — returns string[] in declaration order
 * IR-4: .entries on shape values — returns [["fieldname", descriptor], ...]
 * EC-2: Annotation key absent from field → RuntimeError RILL-R003
 *
 * Also covers direct API checks:
 * - inferType() returns 'field' for a field descriptor
 * - isFieldDescriptor() type guard correctness
 *
 * Note: IR-1 and EC-1 are fully covered by field-descriptor.test.ts.
 * This file adds dispatch tests that require either run() or direct value imports.
 */

import { describe, expect, it } from 'vitest';
import { run, runFull } from '../helpers/runtime.js';
import {
  buildFieldDescriptor,
  inferType,
  isFieldDescriptor,
  RuntimeError,
} from '@rcrsr/rill';
import type {
  RillShape,
  RillShapeFieldDescriptor,
  RillValue,
  ShapeFieldSpec,
} from '@rcrsr/rill';

// ============================================================
// Shared test fixtures
// ============================================================

const LOC = { line: 1, column: 1, offset: 0 };

function makeSpec(
  typeName: string,
  annotations: Record<string, unknown> = {}
): ShapeFieldSpec {
  return {
    typeName,
    optional: false,
    nestedShape: undefined,
    annotations: annotations as ShapeFieldSpec['annotations'],
  };
}

function makeShape(fields: Record<string, ShapeFieldSpec>): RillShape {
  return Object.freeze({
    __rill_shape: true as const,
    fields: Object.freeze(fields),
  });
}

// ============================================================
// inferType for field descriptor (IR-1 adjacent)
// ============================================================

describe('inferType for RillShapeFieldDescriptor', () => {
  it("returns 'field' for a field descriptor value", () => {
    const shape = makeShape({ name: makeSpec('string') });
    const descriptor = buildFieldDescriptor(shape, 'name', LOC);
    expect(inferType(descriptor)).toBe('field');
  });
});

// ============================================================
// isFieldDescriptor type guard
// ============================================================

describe('isFieldDescriptor type guard', () => {
  it('returns true for a valid field descriptor', () => {
    const shape = makeShape({ name: makeSpec('string') });
    const descriptor = buildFieldDescriptor(shape, 'name', LOC);
    expect(isFieldDescriptor(descriptor)).toBe(true);
  });

  it('returns false for a plain dict', () => {
    const dict = { name: 'Alice', age: 30 };
    expect(isFieldDescriptor(dict as never)).toBe(false);
  });

  it('returns false for a shape value', () => {
    const shape = makeShape({ name: makeSpec('string') });
    expect(isFieldDescriptor(shape as never)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isFieldDescriptor('hello' as never)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFieldDescriptor(null as never)).toBe(false);
  });
});

// ============================================================
// IR-2: .^key dispatch on field descriptors via run()
// ============================================================

describe('.^key annotation dispatch on field descriptors (IR-2)', () => {
  it('returns annotation value when annotation key is present', async () => {
    const result = await run(`
      shape(^(description: "user's name") name: string) => $s
      $s.name.^description
    `);
    expect(result).toBe("user's name");
  });

  it('returns numeric annotation value', async () => {
    const result = await run(`
      shape(^(min: 1, max: 100) age: number) => $s
      $s.age.^min
    `);
    expect(result).toBe(1);
  });

  it('returns list annotation value', async () => {
    const result = await run(`
      shape(^(enum: ["admin", "user"]) role: string) => $s
      $s.role.^enum
    `);
    expect(result).toEqual(['admin', 'user']);
  });

  it('returns boolean annotation value', async () => {
    const result = await run(`
      shape(^(required: true) email: string) => $s
      $s.email.^required
    `);
    expect(result).toBe(true);
  });

  it('returns .^keys as list of annotation key names', async () => {
    const result = await run(`
      shape(^(description: "A name", min: 1) name: string) => $s
      $s.name.^keys
    `);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('description');
    expect(result).toContain('min');
  });

  it('EC-2: throws RILL-R003 when annotation key is absent', async () => {
    await expect(
      run(`
        shape(name: string) => $s
        $s.name.^missing
      `)
    ).rejects.toThrow('Annotation "missing" not found on field "name"');
  });

  it('EC-2: error includes both annotation key and field name', async () => {
    await expect(
      run(`
        shape(^(description: "a name") name: string) => $s
        $s.name.^nonexistent
      `)
    ).rejects.toThrow('"nonexistent"');
  });

  it('EC-2: annotation error is RILL-R003', async () => {
    let caught: unknown;
    try {
      await run(`
        shape(age: number) => $s
        $s.age.^absent
      `);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as InstanceType<typeof RuntimeError>).errorId).toBe(
      'RILL-R003'
    );
  });
});

// ============================================================
// IR-3: .keys on shape values
// ============================================================

describe('.keys on shape values (IR-3)', () => {
  it('returns field names for a single-field shape', async () => {
    const result = await run(`
      shape(name: string) => $s
      $s.keys
    `);
    expect(result).toEqual(['name']);
  });

  it('returns all field names for a multi-field shape', async () => {
    const result = await run(`
      shape(name: string, age: number, active: bool) => $s
      $s.keys
    `);
    expect(result).toEqual(['name', 'age', 'active']);
  });

  it('returns empty list for empty shape', async () => {
    const result = await run(`
      shape() => $s
      $s.keys
    `);
    expect(result).toEqual([]);
  });

  it('result is a list (not a dict)', async () => {
    const result = await run(`
      shape(x: number) => $s
      $s.keys
    `);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ============================================================
// IR-4: .entries on shape values
// ============================================================

describe('.entries on shape values (IR-4)', () => {
  it('returns [name, descriptor] pairs for each field', async () => {
    const { variables } = await runFull(`
      shape(name: string) => $s
      $s.entries => $e
      true
    `);
    const entries = variables['e'] as RillValue[];
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    const pair = entries[0] as RillValue[];
    expect(pair[0]).toBe('name');
    expect(isFieldDescriptor(pair[1] as RillShapeFieldDescriptor)).toBe(true);
  });

  it('each descriptor carries the correct fieldName', async () => {
    const { variables } = await runFull(`
      shape(age: number) => $s
      $s.entries => $e
      true
    `);
    const entries = variables['e'] as RillValue[];
    const pair = entries[0] as RillValue[];
    const descriptor = pair[1] as RillShapeFieldDescriptor;
    expect(descriptor.fieldName).toBe('age');
  });

  it('returns one entry per field for multi-field shape', async () => {
    const { variables } = await runFull(`
      shape(a: string, b: number) => $s
      $s.entries => $e
      true
    `);
    const entries = variables['e'] as RillValue[];
    expect(entries).toHaveLength(2);
    const firstPair = entries[0] as RillValue[];
    const secondPair = entries[1] as RillValue[];
    expect(firstPair[0]).toBe('a');
    expect(secondPair[0]).toBe('b');
  });

  it('returns empty list for empty shape', async () => {
    const result = await run(`
      shape() => $s
      $s.entries
    `);
    expect(result).toEqual([]);
  });

  it('descriptor typeName matches declared field type', async () => {
    const { variables } = await runFull(`
      shape(score: number) => $s
      $s.entries => $e
      true
    `);
    const entries = variables['e'] as RillValue[];
    const pair = entries[0] as RillValue[];
    const descriptor = pair[1] as RillShapeFieldDescriptor;
    expect(descriptor.spec.typeName).toBe('number');
  });

  it('descriptor is frozen (entries returns frozen descriptors)', async () => {
    const { variables } = await runFull(`
      shape(label: string) => $s
      $s.entries => $e
      true
    `);
    const entries = variables['e'] as RillValue[];
    const pair = entries[0] as RillValue[];
    const descriptor = pair[1] as RillShapeFieldDescriptor;
    expect(Object.isFrozen(descriptor)).toBe(true);
  });
});
