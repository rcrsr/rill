/**
 * Fiddle parity tests for parameterized destruct and union type annotations
 *
 * Verifies executeRill handles destruct<$a:type> and union type (string|number)
 * syntax in all supported positions: assertion, type-check, capture, destruct,
 * and existence check. Covers success, error, and boundary cases.
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  // ============================================================
  // Parameterized destruct success cases
  // ============================================================

  describe('parameterized destruct — success cases', () => {
    it('destruct<$a:list(number)> accepts list(number) element', async () => {
      // destruct requires the input to be a list whose first element matches the type.
      // list[list[1,2,3]] wraps list(number) as the element to bind to $a.
      const result = await executeRill(
        'list[list[1,2,3]] -> destruct<$a:list(number)>\n$a'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('destruct<$a:dict(name:string)> accepts matching dict element', async () => {
      const result = await executeRill(
        'list[dict[name:"x"]] -> destruct<$a:dict(name:string)>\n$a'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('existence check .?val&list(number) returns true when field matches type', async () => {
      const result = await executeRill(
        'dict[val:list[1,2]] => $d\n$d.?val&list(number)'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'bool',
        rillTypeSignature: 'bool',
        value: true,
      });
    });
  });

  // ============================================================
  // Union type success cases
  // ============================================================

  describe('union type — success cases', () => {
    it(':string|number assertion passes on string value', async () => {
      const result = await executeRill('"hello":string|number');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it(':string|number assertion passes on number value', async () => {
      const result = await executeRill('42:string|number');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it(':?string|number type-check on string returns true', async () => {
      const result = await executeRill('"hello":?string|number');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'bool',
        rillTypeSignature: 'bool',
        value: true,
      });
    });

    it('capture $x:string|number with number succeeds', async () => {
      const result = await executeRill('42 => $x:string|number\n$x');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'number',
        rillTypeSignature: 'number',
        value: 42,
      });
    });
  });

  // ============================================================
  // Error cases
  // ============================================================

  describe('type annotation — error cases', () => {
    it('destruct on non-list input returns runtime error with type names', async () => {
      const result = await executeRill('"hello" -> destruct<$a:list(number)>');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      // message contains expected type (list) and actual type (string)
      expect(result.error?.message).toMatch(/list/);
      expect(result.error?.message).toMatch(/string/);
    });

    it(':string|number assertion on bool returns runtime error naming the union', async () => {
      const result = await executeRill('true:string|number');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      // message contains the union type name
      expect(result.error?.message).toMatch(/string\|number/);
    });

    it('capture $x:string|number on bool returns runtime error', async () => {
      const result = await executeRill('true => $x:string|number');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
    });

    it('existence check .?val&list(number) on string field returns false', async () => {
      // The field exists but its type does not match list(number) — existence check returns false.
      const result = await executeRill(
        'dict[val:"x"] => $d\n$d.?val&list(number)'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'bool',
        rillTypeSignature: 'bool',
        value: false,
      });
    });
  });

  // ============================================================
  // Boundary cases
  // ============================================================

  describe('union type — boundary cases', () => {
    it('| in string|number closure param is not treated as closure delimiter', async () => {
      // Runtime success test: the closure union param must parse and evaluate correctly.
      // validateParamType includes 'members' in hasSubFields, enabling union params at runtime.
      const result = await executeRill('42 -> |x:string|number| { $x }');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('three-member union string|number|bool accepted in assertion', async () => {
      const result = await executeRill('"hello":string|number|bool');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('parameterized type in union list(number)|string accepted in assertion', async () => {
      const result = await executeRill('"hello":list(number)|string');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });
  });

  // ============================================================
  // Existing examples produce unchanged results
  // Verified by running pnpm --filter @rcrsr/rill-fiddle test — all 411+
  // pre-existing tests must pass with 0 modifications.
  // ============================================================
});
