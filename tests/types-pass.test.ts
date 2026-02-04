/**
 * Tests for PASS token type and PassNode AST definition
 */

import { describe, it, expect } from 'vitest';
import { TOKEN_TYPES } from '../src/types.js';
import { KEYWORDS } from '../src/lexer/operators.js';
import { astEquals } from '../src/runtime/core/equals.js';
import type { PassNode } from '../src/types.js';

describe('PASS token type', () => {
  it('exists in TOKEN_TYPES constant', () => {
    expect(TOKEN_TYPES.PASS).toBe('PASS');
  });

  it('maps to PASS token in KEYWORDS lookup', () => {
    expect(KEYWORDS.pass).toBe(TOKEN_TYPES.PASS);
  });
});

describe('PassNode type', () => {
  it('Pass exists in NodeType union', () => {
    // Type-level test: if this compiles, Pass is in the union
    type NodeType = import('../src/types.js').NodeType;
    type TestPass = 'Pass' extends NodeType ? true : false;
    const test: TestPass = true;
    expect(test).toBe(true);
  });

  it('PassNode has correct shape', () => {
    // Type-level test: if this compiles, PassNode matches the pattern
    type PassNode = import('../src/types.js').PassNode;

    const node: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      },
    };

    expect(node.type).toBe('Pass');
    expect(node.span).toBeDefined();
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
