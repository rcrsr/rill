/**
 * Rill Runtime Tests: Shape Validation
 * Tests for to_shape() built-in conversion and shape-related host API.
 *
 * AC = Acceptance Criterion from the shape-type spec.
 * EC = Error Contract from the shape-type spec.
 */

import { describe, expect, it } from 'vitest';
import { inferType, isShape } from '@rcrsr/rill';

import { run, runFull } from '../helpers/runtime.js';

describe('Rill Runtime: Shape Validation', () => {
  // ============================================================
  // to_shape() conversion
  // ============================================================

  describe('to_shape() conversion', () => {
    it('string spec "string" produces typeName "string", optional false (AC-24)', async () => {
      // Validate the shape accepts a conforming dict — confirms field was parsed correctly
      const result = await run(`
        to_shape([name: "string"]) => $s
        [name: "Alice"] -> :$s
      `);
      expect(result).toEqual({ name: 'Alice' });
    });

    it('string spec "string" rejects wrong type — confirms typeName is enforced (AC-24)', async () => {
      await expect(
        run(`
          to_shape([name: "string"]) => $s
          [name: 42] -> :$s
        `)
      ).rejects.toThrow('expected string');
    });

    it('"number?" produces optional field — missing field passes (AC-25)', async () => {
      const result = await run(`
        to_shape([count: "number?"]) => $s
        [:] -> :$s
      `);
      expect(result).toEqual({});
    });

    it('"number?" produces optional field — present field with correct type passes (AC-25)', async () => {
      const result = await run(`
        to_shape([count: "number?"]) => $s
        [count: 5] -> :$s
      `);
      expect(result).toEqual({ count: 5 });
    });

    it('"number?" rejects present field with wrong type — confirms typeName enforced (AC-25)', async () => {
      await expect(
        run(`
          to_shape([count: "number?"]) => $s
          [count: "five"] -> :$s
        `)
      ).rejects.toThrow('expected number');
    });

    it('dict with type key extracts type + annotations (AC-26)', async () => {
      // Annotations stored — enum annotation enforced at validate time
      await expect(
        run(`
          to_shape([role: [type: "string", enum: ["admin", "user"]]]) => $s
          [role: "guest"] -> :$s
        `)
      ).rejects.toThrow('value not in enum');
    });

    it('dict with type key accepts conforming value (AC-26)', async () => {
      const result = await run(`
        to_shape([role: [type: "string", enum: ["admin", "user"]]]) => $s
        [role: "admin"] -> :$s
      `);
      expect(result).toEqual({ role: 'admin' });
    });

    it('dict without type key creates nested shape recursively (AC-27)', async () => {
      const result = await run(`
        to_shape([address: [street: "string", city: "string"]]) => $s
        [address: [street: "Main St", city: "Springfield"]] -> :$s
      `);
      expect(result).toEqual({
        address: { street: 'Main St', city: 'Springfield' },
      });
    });

    it('dict without type key rejects invalid nested field (AC-27)', async () => {
      await expect(
        run(`
          to_shape([address: [street: "string"]]) => $s
          [address: [street: 99]] -> :$s
        `)
      ).rejects.toThrow('expected string');
    });

    it('shape value as top-level arg is returned unchanged (AC-28)', async () => {
      const result = await run(`
        shape(name: string) => $original
        to_shape($original) => $returned
        $returned -> :?shape
      `);
      expect(result).toBe(true);
    });

    it('to_shape() result is the same shape — passthrough identity (AC-28)', async () => {
      // Both shapes must accept the same dict — confirms passthrough
      const result = await run(`
        shape(name: string) => $original
        to_shape($original) => $returned
        [name: "Alice"] -> :$returned
      `);
      expect(result).toEqual({ name: 'Alice' });
    });

    it('empty dict produces empty shape (AC-44)', async () => {
      await expect(run('to_shape([:])')).rejects.toThrow(
        'shapes cannot be returned from scripts'
      );
    });

    it('empty shape accepts any dict (AC-44)', async () => {
      const result = await run(`
        to_shape([:]) => $s
        [x: 1, y: "hello"] -> :$s
      `);
      expect(result).toEqual({ x: 1, y: 'hello' });
    });

    it('invalid field spec throws RILL-R004 with field path (AC-29, EC-6)', async () => {
      // A number value (not string, dict, or shape) is an invalid spec
      await expect(run('to_shape([name: 42])')).rejects.toThrow(
        'to_shape() field spec at "name" has invalid format'
      );
    });

    it('invalid type name in string spec throws with field path (AC-29, EC-6)', async () => {
      await expect(run('to_shape([name: "notatype"])')).rejects.toThrow(
        'to_shape() field spec at "name" has invalid format'
      );
    });

    it('non-dict, non-shape arg throws RILL-R004 (AC-36, EC-5)', async () => {
      await expect(run('to_shape(5)')).rejects.toThrow(
        'must be a dict or shape'
      );
    });

    it('non-dict string arg throws RILL-R004 (AC-36, EC-5)', async () => {
      await expect(run('to_shape("hello")')).rejects.toThrow(
        'must be a dict or shape'
      );
    });

    it('list arg throws RILL-R004 (AC-36, EC-5)', async () => {
      await expect(run('to_shape([1, 2, 3])')).rejects.toThrow(
        'must be a dict or shape'
      );
    });

    it('default annotation type mismatch throws at to_shape() time (AC-45)', async () => {
      // Declaring a "string" field but providing a number default must throw immediately
      await expect(
        run('to_shape([name: [type: "string", default: 42]])')
      ).rejects.toThrow('to_shape() field spec at "name" has invalid format');
    });

    it('default annotation matching field type succeeds at to_shape() time (AC-45)', async () => {
      await expect(
        run('to_shape([name: [type: "string", default: "Alice"]])')
      ).rejects.toThrow('shapes cannot be returned from scripts');
    });
  });

  // ============================================================
  // isShape and inferType host API
  // ============================================================

  describe('isShape and inferType host API', () => {
    it('isShape returns true for a shape produced by to_shape()', async () => {
      const { variables } = await runFull(
        'to_shape([name: "string"]) => $s\ntrue'
      );
      expect(isShape(variables['s'])).toBe(true);
    });

    it('inferType returns "shape" for a shape value', async () => {
      const { variables } = await runFull(
        'to_shape([name: "string"]) => $s\ntrue'
      );
      expect(inferType(variables['s']!)).toBe('shape');
    });

    it('isShape returns true for a shape literal', async () => {
      const { variables } = await runFull('shape(name: string) => $s\ntrue');
      expect(isShape(variables['s'])).toBe(true);
    });

    it('inferType returns "shape" for a shape literal', async () => {
      const { variables } = await runFull('shape(name: string) => $s\ntrue');
      expect(inferType(variables['s']!)).toBe('shape');
    });

    it('isShape returns false for a dict', async () => {
      const result = await run('[name: "Alice"]');
      expect(isShape(result)).toBe(false);
    });

    it('isShape returns false for a string', async () => {
      const result = await run('"hello"');
      expect(isShape(result)).toBe(false);
    });

    it('isShape returns false for a number', async () => {
      const result = await run('42');
      expect(isShape(result)).toBe(false);
    });

    it('isShape returns false for null', () => {
      expect(isShape(null)).toBe(false);
    });
  });
});
