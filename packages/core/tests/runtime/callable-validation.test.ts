/**
 * Rill Runtime Tests: Callable Validation Functions
 * Tests for validateDefaultValueType and validateReturnType
 *
 * Specification Mapping (conduct/specifications/return-type-meta.md):
 * Task 1.1: Return Type Infrastructure
 *
 * Requirements:
 * - IR-1: RillFunctionReturnType type and HostFunctionDefinition.returnType field
 * - EC-1: Invalid return type literal throws Error
 * - EC-4: Invalid return type null throws Error
 * - EC-5: Invalid return type number throws Error
 * - IC-1: callable.ts compiles without type errors
 */

import { describe, expect, it } from 'vitest';
import { validateReturnType } from '@rcrsr/rill';

describe('Callable Validation Functions', () => {
  describe('validateReturnType', () => {
    describe('EC-1: Invalid return type literal', () => {
      it('throws Error for invalid literal "void"', () => {
        expect(() => {
          validateReturnType('void', 'testFn');
        }).toThrow(
          "Invalid returnType for function 'testFn': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for invalid literal "object"', () => {
        expect(() => {
          validateReturnType('object', 'getData');
        }).toThrow(
          "Invalid returnType for function 'getData': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for invalid literal "undefined"', () => {
        expect(() => {
          validateReturnType('undefined', 'nothing');
        }).toThrow(
          "Invalid returnType for function 'nothing': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for invalid literal "array"', () => {
        expect(() => {
          validateReturnType('array', 'getItems');
        }).toThrow(
          "Invalid returnType for function 'getItems': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for empty string', () => {
        expect(() => {
          validateReturnType('', 'emptyType');
        }).toThrow(
          "Invalid returnType for function 'emptyType': expected one of string, number, bool, list, dict, any"
        );
      });
    });

    describe('EC-4: Invalid return type null', () => {
      it('throws Error for null value', () => {
        expect(() => {
          validateReturnType(null, 'nullReturn');
        }).toThrow(
          "Invalid returnType for function 'nullReturn': expected one of string, number, bool, list, dict, any"
        );
      });
    });

    describe('EC-5: Invalid return type number', () => {
      it('throws Error for number value 42', () => {
        expect(() => {
          validateReturnType(42, 'numReturn');
        }).toThrow(
          "Invalid returnType for function 'numReturn': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for number value 0', () => {
        expect(() => {
          validateReturnType(0, 'zeroReturn');
        }).toThrow(
          "Invalid returnType for function 'zeroReturn': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for number value -1', () => {
        expect(() => {
          validateReturnType(-1, 'negativeReturn');
        }).toThrow(
          "Invalid returnType for function 'negativeReturn': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for floating point number', () => {
        expect(() => {
          validateReturnType(3.14, 'floatReturn');
        }).toThrow(
          "Invalid returnType for function 'floatReturn': expected one of string, number, bool, list, dict, any"
        );
      });
    });

    describe('IR-1: Valid return type literals', () => {
      it('accepts "string" without throwing', () => {
        expect(() => {
          validateReturnType('string', 'getText');
        }).not.toThrow();
      });

      it('accepts "number" without throwing', () => {
        expect(() => {
          validateReturnType('number', 'getNum');
        }).not.toThrow();
      });

      it('accepts "bool" without throwing', () => {
        expect(() => {
          validateReturnType('bool', 'getFlag');
        }).not.toThrow();
      });

      it('accepts "list" without throwing', () => {
        expect(() => {
          validateReturnType('list', 'getList');
        }).not.toThrow();
      });

      it('accepts "dict" without throwing', () => {
        expect(() => {
          validateReturnType('dict', 'getDict');
        }).not.toThrow();
      });

      it('accepts "any" without throwing', () => {
        expect(() => {
          validateReturnType('any', 'getAny');
        }).not.toThrow();
      });
    });

    describe('Error messages include function name', () => {
      it('includes function name in error message', () => {
        expect(() => {
          validateReturnType('invalid', 'myCustomFunction');
        }).toThrow('myCustomFunction');
      });

      it('includes expected types in error message', () => {
        expect(() => {
          validateReturnType('bad', 'fn');
        }).toThrow('string, number, bool, list, dict, any');
      });
    });

    describe('Edge cases', () => {
      it('throws Error for boolean value true', () => {
        expect(() => {
          validateReturnType(true, 'boolValue');
        }).toThrow(
          "Invalid returnType for function 'boolValue': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for boolean value false', () => {
        expect(() => {
          validateReturnType(false, 'boolValue');
        }).toThrow(
          "Invalid returnType for function 'boolValue': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for object value', () => {
        expect(() => {
          validateReturnType({}, 'objValue');
        }).toThrow(
          "Invalid returnType for function 'objValue': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for array value', () => {
        expect(() => {
          validateReturnType([], 'arrValue');
        }).toThrow(
          "Invalid returnType for function 'arrValue': expected one of string, number, bool, list, dict, any"
        );
      });

      it('throws Error for undefined value', () => {
        expect(() => {
          validateReturnType(undefined, 'undefValue');
        }).toThrow(
          "Invalid returnType for function 'undefValue': expected one of string, number, bool, list, dict, any"
        );
      });
    });
  });
});
