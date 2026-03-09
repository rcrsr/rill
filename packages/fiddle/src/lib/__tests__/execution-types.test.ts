/**
 * Fiddle parity tests for parameterized destruct and union type annotations
 *
 * Verifies executeRill handles destruct<$a:type> and union type (string|number)
 * syntax in all supported positions: assertion, type-check, capture, destruct,
 * and existence check. Covers success, error, and boundary cases.
 *
 * AC = Acceptance Criterion, EC = Error Contract
 * from the type-system-improvements spec (Phase 3, Task 3.2).
 *
 * Covers: AC-47, AC-48, AC-49, AC-50, AC-51 / AC-FDL-1 through AC-FDL-15
 */

import { describe, it, expect } from 'vitest';
import { executeRill } from '../execution.js';

describe('executeRill', () => {
  // ============================================================
  // AC-47: Parameterized destruct success cases (AC-FDL-1, 2, 3)
  // ============================================================

  describe('parameterized destruct — success cases', () => {
    it('AC-FDL-1: destruct<$a:list(number)> accepts list(number) element', async () => {
      // destruct requires the input to be a list whose first element matches the type.
      // list[list[1,2,3]] wraps list(number) as the element to bind to $a.
      const result = await executeRill(
        'list[list[1,2,3]] -> destruct<$a:list(number)>\n$a'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('AC-FDL-2: destruct<$a:dict(name:string)> accepts matching dict element', async () => {
      const result = await executeRill(
        'list[dict[name:"x"]] -> destruct<$a:dict(name:string)>\n$a'
      );

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('AC-FDL-3: existence check .?val&list(number) returns true when field matches type', async () => {
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
  // AC-48: Union type success cases (AC-FDL-4, 5, 6, 7)
  // ============================================================

  describe('union type — success cases', () => {
    it('AC-FDL-4: :string|number assertion passes on string value', async () => {
      const result = await executeRill('"hello":string|number');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('AC-FDL-5: :string|number assertion passes on number value', async () => {
      const result = await executeRill('42:string|number');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('AC-FDL-6: :?string|number type-check on string returns true', async () => {
      const result = await executeRill('"hello":?string|number');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
      expect(JSON.parse(result.result!)).toEqual({
        rillTypeName: 'bool',
        rillTypeSignature: 'bool',
        value: true,
      });
    });

    it('AC-FDL-7: capture $x:string|number with number succeeds', async () => {
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
  // AC-49: Error cases (AC-FDL-8, 9, 10, 11)
  // ============================================================

  describe('type annotation — error cases', () => {
    it('AC-FDL-8/EC-3: destruct on non-list input returns runtime error with type names', async () => {
      const result = await executeRill('"hello" -> destruct<$a:list(number)>');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      // EC-3: message contains expected type (list) and actual type (string)
      expect(result.error?.message).toMatch(/list/);
      expect(result.error?.message).toMatch(/string/);
    });

    it('AC-FDL-9/EC-2: :string|number assertion on bool returns runtime error naming the union', async () => {
      const result = await executeRill('true:string|number');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
      // EC-2: message contains the union type name
      expect(result.error?.message).toMatch(/string\|number/);
    });

    it('AC-FDL-10: capture $x:string|number on bool returns runtime error', async () => {
      const result = await executeRill('true => $x:string|number');

      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error?.category).toBe('runtime');
    });

    it('AC-FDL-11: existence check .?val&list(number) on string field returns false', async () => {
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
  // AC-50: Boundary cases (AC-FDL-12, 13, 14)
  // ============================================================

  describe('union type — boundary cases', () => {
    it('AC-FDL-12: | in string|number closure param is not treated as closure delimiter', async () => {
      // Runtime success test: the closure union param must parse and evaluate correctly.
      // validateParamType includes 'members' in hasSubFields, enabling union params at runtime.
      const result = await executeRill('42 -> |x:string|number| { $x }');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('AC-FDL-13: three-member union string|number|bool accepted in assertion', async () => {
      const result = await executeRill('"hello":string|number|bool');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });

    it('AC-FDL-14: parameterized type in union list(number)|string accepted in assertion', async () => {
      const result = await executeRill('"hello":list(number)|string');

      expect(result.status).toBe('success');
      expect(result.error).toBe(null);
    });
  });

  // ============================================================
  // AC-51: Existing examples produce unchanged results (AC-FDL-15)
  // Verified by running pnpm --filter @rcrsr/rill-fiddle test — all 411+
  // pre-existing tests must pass with 0 modifications.
  // ============================================================
});
