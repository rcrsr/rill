/**
 * Tests for PassNode AST structure
 * Verifies PassNode structure without testing parser method directly
 */

import { describe, expect, it } from 'vitest';
import type { PassNode } from '../../src/types.js';

describe('PassNode structure', () => {
  it('has correct type field (IR-2)', () => {
    const node: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      },
    };

    expect(node.type).toBe('Pass');
  });

  it('requires span field (IR-2)', () => {
    const node: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      },
    };

    expect(node.span).toBeDefined();
    expect(node.span.start).toBeDefined();
    expect(node.span.end).toBeDefined();
  });

  it('allows different span locations (IR-2)', () => {
    const node1: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      },
    };

    const node2: PassNode = {
      type: 'Pass',
      span: {
        start: { offset: 10, line: 2, column: 3 },
        end: { offset: 14, line: 2, column: 7 },
      },
    };

    expect(node1.type).toBe('Pass');
    expect(node2.type).toBe('Pass');
    expect(node1.span.start.line).toBe(1);
    expect(node2.span.start.line).toBe(2);
  });
});
