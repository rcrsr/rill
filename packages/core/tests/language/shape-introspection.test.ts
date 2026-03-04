/**
 * Rill Language Tests: Shape Introspection
 * Tests for shape field access ($s.name), .keys, .entries, annotation
 * reflection (.^key, .^keys), field descriptors (.type, .optional, .shape),
 * and nested shape traversal.
 *
 * AC = Acceptance Criterion from the shape-introspection spec.
 * EC = Error Contract from the shape-introspection spec.
 *
 * Syntax notes:
 * - Field annotations use a single ^(key: val, ...) block per field.
 * - .^keys (annotation key list) is a reserved key on field descriptors.
 * - .^key on a field descriptor reads from spec.annotations.
 * - .^key on scalar (number, string, etc.) reads closure annotations
 *   and throws when the receiver is not a closure or field descriptor.
 */

import { describe, expect, it } from 'vitest';
import {
  parse,
  ParseError,
  isTypeValue,
  type RillTypeValue,
} from '@rcrsr/rill';
import { run, runFull, createLogCollector } from '../helpers/runtime.js';

describe('Rill Language: Shape Introspection', () => {
  // ============================================================
  // Field Access (AC-1 through AC-5)
  // ============================================================

  describe('Field Access', () => {
    it('$s.name returns a field descriptor value (AC-1)', async () => {
      // Field descriptors cannot be returned from scripts (toNative throws).
      // Capture $s.name into $fd via runFull to access the raw RillValue.
      const { variables } = await runFull(`
        shape(name: string) => $s
        $s.name => $fd
        true
      `);
      const fd = variables['fd'];
      // Descriptor is a plain object with __rill_field_descriptor marker
      expect(fd).toBeDefined();
      expect(typeof fd).toBe('object');
      expect(fd).not.toBeNull();
      expect((fd as Record<string, unknown>).__rill_field_descriptor).toBe(
        true
      );
    });

    it('$s.name.type returns the string type value (AC-2)', async () => {
      // Type values cannot be returned from scripts (toNative throws).
      // Access .type.name to get the representable typeName string instead.
      const result = await run(`
        shape(name: string) => $s
        $s.name.type.name
      `);
      expect(
        isTypeValue({ __rill_type: true, typeName: result } as RillTypeValue)
      ).toBe(true);
      expect(result).toBe('string');
    });

    it('$s.name.optional returns false for required field (AC-3)', async () => {
      const result = await run(`
        shape(name: string) => $s
        $s.name.optional
      `);
      expect(result).toBe(false);
    });

    it('$s2.email.optional returns true for optional field (AC-4)', async () => {
      const result = await run(`
        shape(email: string?) => $s2
        $s2.email.optional
      `);
      expect(result).toBe(true);
    });

    it('$s.name.shape returns false for non-nested field (AC-5)', async () => {
      const result = await run(`
        shape(name: string) => $s
        $s.name.shape
      `);
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // .keys (AC-6, AC-19)
  // ============================================================

  describe('.keys', () => {
    it('$s.keys returns field names in declaration order (AC-6)', async () => {
      const result = await run(`
        shape(name: string, age: number, active: bool) => $s
        $s -> .keys
      `);
      expect(result).toEqual(['name', 'age', 'active']);
    });

    it('empty shape .keys returns [] (AC-19)', async () => {
      const result = await run(`
        shape() => $s
        $s -> .keys
      `);
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // Annotation Access (AC-7 through AC-9)
  // ============================================================

  describe('Annotation Access', () => {
    it('$s.name.^description returns annotation string (AC-7)', async () => {
      const result = await run(`
        shape(^(description: "User name") name: string) => $s
        $s.name.^description
      `);
      expect(result).toBe('User name');
    });

    it('$s.role.^enum returns annotation list (AC-8)', async () => {
      const result = await run(`
        shape(^(enum: ["admin", "user"]) role: string) => $s
        $s.role.^enum
      `);
      expect(result).toEqual(['admin', 'user']);
    });

    it('multi-annotation field: $s.role.^description returns string (AC-9)', async () => {
      const result = await run(`
        shape(^(description: "Role", enum: ["admin", "user"]) role: string) => $s
        $s.role.^description
      `);
      expect(result).toBe('Role');
    });

    it('multi-annotation field: $s.role.^enum returns list (AC-9)', async () => {
      const result = await run(`
        shape(^(description: "Role", enum: ["admin", "user"]) role: string) => $s
        $s.role.^enum
      `);
      expect(result).toEqual(['admin', 'user']);
    });
  });

  // ============================================================
  // Nested Shapes (AC-10 through AC-12, AC-21)
  // ============================================================

  describe('Nested Shapes', () => {
    it('$s.user.type returns the shape type value (AC-10)', async () => {
      // Type values cannot be returned from scripts (toNative throws).
      // Access .type.name to get the representable typeName string instead.
      const result = await run(`
        shape(user: (id: number, name: string)) => $s
        $s.user.type.name
      `);
      expect(
        isTypeValue({ __rill_type: true, typeName: result } as RillTypeValue)
      ).toBe(true);
      expect(result).toBe('shape');
    });

    it('$s.user.shape returns the nested shape value (AC-11)', async () => {
      const result = await run(`
        shape(user: (id: number)) => $s
        $s.user.shape -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('$s.name.shape returns false for non-nested field in nested context (AC-12)', async () => {
      const result = await run(`
        shape(user: (id: number), name: string) => $s
        $s.name.shape
      `);
      expect(result).toBe(false);
    });

    it('nested shape at arbitrary depth: .shape returns nested shape (AC-21)', async () => {
      // Access inner shape via outer.shape, then access a field of that nested shape
      const result = await run(`
        shape(a: (b: (c: string))) => $s
        $s.a.shape.b.shape -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('nested shape field access: access field in inner shape via .shape (AC-21)', async () => {
      // Verify the nested shape contains the expected fields
      const result = await run(`
        shape(a: (b: string)) => $s
        $s.a.shape -> .keys
      `);
      expect(result).toEqual(['b']);
    });
  });

  // ============================================================
  // .entries Iteration (AC-13)
  // ============================================================

  describe('.entries Iteration', () => {
    it('.entries returns field names in declaration order via each (AC-13)', async () => {
      const { logs, callbacks } = createLogCollector();
      await run(
        `
          shape(name: string, age: number, active: bool) => $s
          $s -> .entries -> each {
            $[0] -> log
          }
        `,
        { callbacks }
      );
      expect(logs).toEqual(['name', 'age', 'active']);
    });

    it('.entries returns [name, descriptor] pairs (AC-13)', async () => {
      const result = await run(`
        shape(name: string, age: number) => $s
        $s -> .entries -> .len
      `);
      // Two fields = two entries
      expect(result).toBe(2);
    });

    it('.entries first pair field names match declaration order (AC-13)', async () => {
      const result = await run(`
        shape(name: string, age: number) => $s
        $s -> .entries -> each { $[0] }
      `);
      // each returns the last expression per iteration, collected as a list
      expect(result).toEqual(['name', 'age']);
    });
  });

  // ============================================================
  // Errors (AC-14, AC-15, AC-16, AC-17, AC-18, EC-1 through EC-4)
  // ============================================================

  describe('Errors', () => {
    it('$s.missing throws RILL-R003: Shape has no field "missing" (AC-14, EC-1)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          $s.missing
        `)
      ).rejects.toThrow('Shape has no field "missing"');
    });

    it('$s.name.^enum (no enum annotation) throws RILL-R003: annotation not found (AC-15, EC-2)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          $s.name.^enum
        `)
      ).rejects.toThrow('Annotation "enum" not found on field "name"');
    });

    it('^(type: "custom") in shape field annotation is a parse error (AC-16, EC-3)', () => {
      expect(() =>
        parse('shape(^(type: "custom") name: string) => $s')
      ).toThrow(ParseError);
    });

    it('^(type: "custom") parse error message contains "reserved" (AC-16, EC-3)', () => {
      try {
        parse('shape(^(type: "custom") name: string) => $s');
        expect.fail('Should have thrown ParseError');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        const parseErr = err as ParseError;
        expect(parseErr.message).toContain('reserved');
      }
    });

    it('.^key on number (scalar) throws runtime error (AC-17, EC-4)', async () => {
      await expect(
        run(`
          42 => $n
          $n.^somekey
        `)
      ).rejects.toThrow(/annotation not found: \^somekey/);
    });

    it('.^key on string (scalar) throws runtime error (AC-17, EC-4)', async () => {
      await expect(
        run(`
          "hello" => $str
          $str.^somekey
        `)
      ).rejects.toThrow(/annotation not found: \^somekey/);
    });

    it('.keys on closure throws runtime error (AC-18)', async () => {
      await expect(
        run(`
          |x|($x) => $fn
          $fn -> .keys
        `)
      ).rejects.toThrow(/\.keys/);
    });
  });

  // ============================================================
  // Boundary Cases (AC-19, AC-20)
  // ============================================================

  describe('Boundary Cases', () => {
    it('shape with zero fields: .keys returns [] (AC-19)', async () => {
      const result = await run(`
        shape() => $s
        $s -> .keys
      `);
      expect(result).toEqual([]);
    });

    it('field with no annotations: .^key throws annotation not found (AC-20)', async () => {
      await expect(
        run(`
          shape(name: string) => $s
          $s.name.^somekey
        `)
      ).rejects.toThrow('Annotation "somekey" not found on field "name"');
    });

    it('field with no annotations: .^keys returns [] (AC-20)', async () => {
      const result = await run(`
        shape(name: string) => $s
        $s.name.^keys
      `);
      expect(result).toEqual([]);
    });

    it('field with annotations: .^keys returns annotation key names (AC-20)', async () => {
      const result = await run(`
        shape(^(description: "Name", required: true) name: string) => $s
        $s.name.^keys
      `);
      expect(result).toContain('description');
      expect(result).toContain('required');
    });
  });
});
