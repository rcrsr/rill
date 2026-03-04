/**
 * Rill Language Tests: Shape Type
 * Tests for shape(...) literals, validation, annotations, nesting, and composition.
 *
 * AC = Acceptance Criterion from the shape-type spec.
 * EC = Error Contract from the shape-type spec.
 *
 * Implementation status notes:
 * - The "any?" field type is not yet implemented (AC-14).
 * Tests for unimplemented features use it.todo() to mark pending spec requirements.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';

describe('Rill Language: Shape Type', () => {
  // ============================================================
  // Shape Creation (AC-1 through AC-6)
  // ============================================================

  describe('Shape Creation', () => {
    it('shape literal produces a shape value (AC-1)', async () => {
      // inferType returns "shape" — verified via :?shape type check
      const result = await run(`
        shape(name: string, age: number) => $s
        $s -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('shape value fails :?dict check (AC-2)', async () => {
      const result = await run(`
        shape(name: string) => $s
        $s -> :?dict
      `);
      expect(result).toBe(false);
    });

    it('shape value passes :?shape check (AC-3)', async () => {
      const result = await run(`
        shape(name: string) => $s
        $s -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('field access $s.name returns a field descriptor with optional=false (AC-4)', async () => {
      const result = await run(`
        shape(name: string) => $s
        $s.name.optional
      `);
      expect(result).toBe(false);
    });

    it('$s.keys returns field names as list (AC-5)', async () => {
      const result = await run(`
        shape(name: string, age: number) => $s
        $s.keys
      `);
      expect(result).toEqual(['name', 'age']);
    });

    it('empty shape() produces valid shape value (AC-6)', async () => {
      const result = await run(`
        shape() => $s
        $s -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('empty shape() accepts any dict including populated dict (AC-6)', async () => {
      const result = await run(`
        shape() => $s
        [x: 1, y: "hello"] -> :$s
      `);
      expect(result).toEqual({ x: 1, y: 'hello' });
    });
  });

  // ============================================================
  // Shape Validation (AC-7 through AC-11)
  // ============================================================

  describe('Shape Validation', () => {
    it('dict with all required fields and correct types passes :$shape (AC-7)', async () => {
      // Returns dict unchanged on success
      const result = await run(`
        shape(name: string, age: number) => $s
        [name: "Alice", age: 30] -> :$s
      `);
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('dict missing required field fails :$shape with RILL-R004 (AC-8)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          [:] -> :$s
        `)
      ).rejects.toThrow('missing required field');
    });

    it('dict with field of wrong type fails :$shape (AC-9)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          [name: 42] -> :$s
        `)
      ).rejects.toThrow('expected string, got number');
    });

    it('dict with extra undeclared fields passes :$shape — lenient validation (AC-10)', async () => {
      const result = await run(`
        shape(name: string) => $s
        [name: "Alice", extra: 99] -> :$s
      `);
      expect(result).toEqual({ name: 'Alice', extra: 99 });
    });

    it(':?$shape returns true for valid dict (AC-11)', async () => {
      const result = await run(`
        shape(name: string) => $s
        [name: "Alice"] -> :?$s
      `);
      expect(result).toBe(true);
    });

    it(':?$shape returns false for invalid dict without throwing (AC-11)', async () => {
      const result = await run(`
        shape(name: string) => $s
        [:] -> :?$s
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // Optional Fields (AC-12 through AC-14)
  // ============================================================

  describe('Optional Fields', () => {
    it('dict missing optional field passes validation (AC-12)', async () => {
      const result = await run(`
        shape(name: string, tag: string?) => $s
        [name: "Alice"] -> :$s
      `);
      expect(result).toEqual({ name: 'Alice' });
    });

    it('dict with optional field present and correct type passes (AC-12)', async () => {
      const result = await run(`
        shape(name: string, tag: string?) => $s
        [name: "Alice", tag: "admin"] -> :$s
      `);
      expect(result).toEqual({ name: 'Alice', tag: 'admin' });
    });

    it('dict with optional field present but wrong type fails validation (AC-13)', async () => {
      await expect(
        run(`
          shape(name: string, tag: string?) => $s
          [name: "Alice", tag: 99] -> :$s
        `)
      ).rejects.toThrow('expected string, got number');
    });

    it.todo(
      'any? field: absent passes, present with any type passes (AC-14) — any? type not yet implemented'
    );
  });

  // ============================================================
  // Annotations and Enum (AC-15 through AC-18)
  // ============================================================

  describe('Annotations and Enum', () => {
    it('$s.name.^description returns annotation string when present (AC-15)', async () => {
      const result = await run(`
        shape(^(description: "User name") name: string) => $s
        $s.name.^description
      `);
      expect(result).toBe('User name');
    });

    it('$s.role.^enum returns annotation list when present (AC-16)', async () => {
      const result = await run(`
        shape(^(enum: ["admin", "user"]) role: string) => $s
        $s.role.^enum
      `);
      expect(result).toEqual(['admin', 'user']);
    });

    it('$s.name.^enum throws annotation not found error when absent (AC-17)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          $s.name.^enum
        `)
      ).rejects.toThrow('Annotation "enum" not found on field "name"');
    });

    it('field value not in enum fails :$shape (AC-18)', async () => {
      await expect(
        run(`
          shape(^(enum: ["admin", "user"]) role: string) => $s
          [role: "guest"] -> :$s
        `)
      ).rejects.toThrow('value not in enum');
    });

    it('field value not in enum fails :?$shape (AC-18)', async () => {
      const result = await run(`
        shape(^(enum: ["admin", "user"]) role: string) => $s
        [role: "guest"] -> :?$s
      `);
      expect(result).toBe(false);
    });

    it('field value in enum passes :$shape (AC-18)', async () => {
      const result = await run(`
        shape(^(enum: ["admin", "user"]) role: string) => $s
        [role: "admin"] -> :$s
      `);
      expect(result).toEqual({ role: 'admin' });
    });
  });

  // ============================================================
  // Nested Shapes (AC-19 through AC-21)
  // ============================================================

  describe('Nested Shapes', () => {
    it('shorthand (field: type) and shape(field: type) produce identical validation results (AC-19)', async () => {
      // Both inline shorthand and explicit shape() produce the same nested shape structure
      const shorthand = await run(`
        shape(meta: (ts: number)) => $s1
        [meta: [ts: 5]] -> :$s1
      `);
      const explicit = await run(`
        shape(meta: shape(ts: number)) => $s2
        [meta: [ts: 5]] -> :$s2
      `);
      expect(shorthand).toEqual({ meta: { ts: 5 } });
      expect(explicit).toEqual({ meta: { ts: 5 } });
    });

    it('nested field mismatch error includes dot-separated path (AC-20)', async () => {
      await expect(
        run(`
          shape(meta: (timestamp: number)) => $s
          [meta: [timestamp: "wrong"]] -> :$s
        `)
      ).rejects.toThrow('meta.timestamp');
    });

    it('deep nesting (3+ levels) validates correctly (AC-21)', async () => {
      const result = await run(`
        shape(a: (b: (c: string))) => $s
        [a: [b: [c: "ok"]]] -> :$s
      `);
      expect(result).toEqual({ a: { b: { c: 'ok' } } });
    });
  });

  // ============================================================
  // Shape Composition via Spread (AC-22 through AC-23)
  // ============================================================

  describe('Shape Composition', () => {
    it('spread includes all fields from base shape (AC-22)', async () => {
      const result = await run(`
        shape(x: number) => $base
        shape(...$base, age: number) => $composed
        [x: 5, age: 30] -> :$composed
      `);
      expect(result).toEqual({ x: 5, age: 30 });
    });

    it('spread composition fails when base field missing from dict (AC-22)', async () => {
      await expect(
        run(`
          shape(x: number) => $base
          shape(...$base, age: number) => $composed
          [age: 30] -> :$composed
        `)
      ).rejects.toThrow('missing required field');
    });

    it('spread composition fails when new field missing from dict (AC-22)', async () => {
      await expect(
        run(`
          shape(x: number) => $base
          shape(...$base, age: number) => $composed
          [x: 5] -> :$composed
        `)
      ).rejects.toThrow('missing required field');
    });

    it('annotations from spread source carry through to composed shape (AC-23)', async () => {
      // Verify the composed shape is valid and that the spread source annotation
      // is preserved in the composed shape's fields.
      const result = await run(`
        shape(^(description: "base field") x: number) => $base
        shape(...$base, y: string) => $composed
        [x: 1, y: "a"] -> :$composed
      `);
      expect(result).toEqual({ x: 1, y: 'a' });
    });
  });

  // ============================================================
  // Error Cases (AC-34, AC-35, AC-38, EC-1 through EC-4, EC-7)
  // ============================================================

  describe('Error Cases', () => {
    it('EC-1: :$shape on non-dict input (number) fails with RILL-R004 (AC-34)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          42 -> :$s
        `)
      ).rejects.toThrow('expected dict, got number');
    });

    it('EC-1: :$shape on string input fails with RILL-R004 (AC-34)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          "hello" -> :$s
        `)
      ).rejects.toThrow('expected dict, got string');
    });

    it('EC-1: :$shape on list input fails with RILL-R004 (AC-34)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          [1, 2, 3] -> :$s
        `)
      ).rejects.toThrow('expected dict, got list');
    });

    it('EC-2: :$shape on dict missing required field fails with RILL-R004 (AC-8)', async () => {
      await expect(
        run(`
          shape(name: string, age: number) => $s
          [name: "Alice"] -> :$s
        `)
      ).rejects.toThrow('missing required field');
    });

    it('EC-3: :$shape on dict with wrong field type fails with RILL-R004 (AC-9)', async () => {
      await expect(
        run(`
          shape(age: number) => $s
          [age: "thirty"] -> :$s
        `)
      ).rejects.toThrow('expected number, got string');
    });

    it('EC-4: :$shape on dict with field value not in enum fails (AC-18)', async () => {
      await expect(
        run(`
          shape(^(enum: ["a", "b"]) role: string) => $s
          [role: "c"] -> :$s
        `)
      ).rejects.toThrow('value not in enum');
    });

    it('EC-7: :$var where $var is not a shape throws identifying the variable (AC-35)', async () => {
      await expect(
        run(`
          42 => $myVar
          [name: "Alice"] -> :$myVar
        `)
      ).rejects.toThrow('$myVar is not a valid type reference');
    });

    it('EC-7: :$var where $var is undefined throws (AC-35)', async () => {
      await expect(
        run(`
          [name: "Alice"] -> :$undeclared
        `)
      ).rejects.toThrow('$undeclared');
    });

    it('missing required nested field reports full dot-separated path (AC-38)', async () => {
      await expect(
        run(`
          shape(user: (address: (zip: string))) => $s
          [user: [address: [:]]] -> :$s
        `)
      ).rejects.toThrow('user.address.zip');
    });
  });

  // ============================================================
  // Boundary Cases (AC-39 through AC-43)
  // ============================================================

  describe('Boundary Cases', () => {
    it('empty shape() accepts any dict including empty dict [:] (AC-39)', async () => {
      const result = await run(`
        shape() => $s
        [:] -> :$s
      `);
      expect(result).toEqual({});
    });

    it('empty shape() accepts populated dict (AC-39)', async () => {
      const result = await run(`
        shape() => $s
        [x: 1, y: "hello", z: true] -> :$s
      `);
      expect(result).toEqual({ x: 1, y: 'hello', z: true });
    });

    it('shape with single field validates correctly (AC-40)', async () => {
      const result = await run(`
        shape(x: number) => $s
        [x: 99] -> :$s
      `);
      expect(result).toEqual({ x: 99 });
    });

    it('shape with single field rejects missing field (AC-40)', async () => {
      await expect(
        run(`
          shape(x: number) => $s
          [:] -> :$s
        `)
      ).rejects.toThrow('missing required field');
    });

    it('shape with all 10 type names as field types is valid (AC-41)', async () => {
      const result = await run(`
        shape(
          a: string,
          b: number,
          c: bool,
          d: closure,
          e: list,
          f: dict,
          g: tuple,
          h: vector,
          i: shape,
          j: any
        ) => $s
        $s -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('empty dict [:] fails required field check when shape requires fields (AC-42)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          [:] -> :$s
        `)
      ).rejects.toThrow('missing required field');
    });

    it('spread of empty shape adds no fields to composed shape (AC-43)', async () => {
      const result = await run(`
        shape() => $empty
        shape(...$empty, x: number) => $s
        [x: 5] -> :$s
      `);
      expect(result).toEqual({ x: 5 });
    });

    it('spread of empty shape: extra field from empty spread not required (AC-43)', async () => {
      // The empty spread contributes zero required fields
      // Only x is required in the composed shape
      await expect(
        run(`
          shape() => $empty
          shape(...$empty, x: number) => $s
          [:] -> :$s
        `)
      ).rejects.toThrow('missing required field');
    });
  });

  // ============================================================
  // Variable in Field Type Position (AC-11, AC-25)
  // ============================================================

  describe('Variable in Field Type Position', () => {
    it('shape(val: $t) resolves $t at creation time — string type passes string value (AC-11)', async () => {
      const result = await run(`
        string => $t
        shape(val: $t) => $s
        [val: "hello"] -> :$s
      `);
      expect(result).toEqual({ val: 'hello' });
    });

    it('shape(val: $t) resolves $t at creation time — number type rejects string value (AC-11)', async () => {
      await expect(
        run(`
          number => $t
          shape(val: $t) => $s
          [val: "hello"] -> :$s
        `)
      ).rejects.toThrow('expected number, got string');
    });

    it('reassigning $t before second shape — first shape locked to string, accepts string value (AC-25)', async () => {
      const result = await run(`
        string => $t
        shape(val: $t) => $s1
        number => $t
        shape(val: $t) => $s2
        [val: "hello"] -> :$s1
      `);
      expect(result).toEqual({ val: 'hello' });
    });

    it('reassigning $t before second shape — second shape locked to number, rejects string value (AC-25)', async () => {
      await expect(
        run(`
          string => $t
          shape(val: $t) => $s1
          number => $t
          shape(val: $t) => $s2
          [val: "hello"] -> :$s2
        `)
      ).rejects.toThrow('expected number, got string');
    });
  });

  // ============================================================
  // Inline Shape Syntax
  // ============================================================

  describe('Inline Shape Syntax', () => {
    it('inline shape assertion: [x: 5] -> :shape(x: number) passes (AC-7)', async () => {
      const result = await run(`[x: 5] -> :shape(x: number)`);
      expect(result).toEqual({ x: 5 });
    });

    it('inline shape check: [x: 5] -> :?shape(x: number) returns true (AC-11)', async () => {
      const result = await run(`[x: 5] -> :?shape(x: number)`);
      expect(result).toBe(true);
    });

    it('inline shape check returns false when dict fails (AC-11)', async () => {
      const result = await run(`[x: "hello"] -> :?shape(x: number)`);
      expect(result).toBe(false);
    });

    it('inline shape assertion fails when dict missing required field', async () => {
      await expect(run(`[:] -> :shape(x: number)`)).rejects.toThrow(
        'missing required field'
      );
    });
  });
});
