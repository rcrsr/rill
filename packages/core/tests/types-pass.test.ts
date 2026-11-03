/**
 * Tests for PASS token type and PassNode AST definition
 */

import { describe, it, expect } from 'vitest';
import { TOKEN_TYPES } from '@rcrsr/rill';
import { KEYWORDS } from '../src/lexer/operators.js';
import { astEquals } from '../src/runtime/core/equals.js';
import type { PassNode } from '@rcrsr/rill';

describe('PASS token type', () => {
  it('exists in TOKEN_TYPES constant', () => {
    expect(TOKEN_TYPES.PASS).toBe('PASS');
  });

  it('maps to PASS token in KEYWORDS lookup', () => {
    expect(KEYWORDS['pass']).toBe(TOKEN_TYPES.PASS);
  });
});

describe('PassNode equality (astEquals)', () => {
  it('considers two PassNodes equal regardless of span', () => {
    const pass1: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      },
    };

    const pass2: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 10, line: 2, column: 1 },
        end: { offset: 14, line: 2, column: 5 },
      },
    };

    expect(astEquals(pass1, pass2)).toBe(true);
  });

  it('considers identical PassNodes equal', () => {
    const pass: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      },
    };

    expect(astEquals(pass, pass)).toBe(true);
  });
});
