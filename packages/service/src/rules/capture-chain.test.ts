/**
 * Unit tests for the shared capture/chain-adjacency predicate,
 * `isImmediatelyChained`, lifted from throwaway-capture.ts so
 * CAPTURE_INLINE_CHAIN and THROWAWAY_CAPTURE evaluate one definition
 * instead of two independently maintained copies.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@rcrsr/rill';
import type { ASTNode, ScriptNode } from '@rcrsr/rill';
import {
  getInnerStatement,
  getPrimaryFromHead,
  isImmediatelyChained,
} from './capture-chain.js';

const RULES_DIR = join(import.meta.dirname, '.');

describe('isImmediatelyChained', () => {
  it('returns true for a reference inside the immediately-following statement', () => {
    const source = 'prompt("Read file") => $raw\n$raw -> log\n';
    const scriptNode = parse(source) as unknown as ScriptNode;
    const statements: readonly ASTNode[] = scriptNode.statements;

    // statements[1] is `$raw -> log`; its head Variable node is the
    // reference used to decide adjacency.
    const refNode = getPrimaryFromHead(
      getInnerStatement(statements[1]!)!.expression
    )!;

    expect(isImmediatelyChained(0, refNode, statements)).toBe(true);
  });

  it('returns false for a reference in a non-adjacent statement', () => {
    const source = 'prompt("Read file") => $raw\nlog("noop")\n$raw -> log\n';
    const scriptNode = parse(source) as unknown as ScriptNode;
    const statements: readonly ASTNode[] = scriptNode.statements;

    // statements[2] is `$raw -> log`, two statements away from the
    // capture at statements[0]; the shared adjacency window only spans
    // statements[0 + 1].
    const refNode = getPrimaryFromHead(
      getInnerStatement(statements[2]!)!.expression
    )!;

    expect(isImmediatelyChained(0, refNode, statements)).toBe(false);
  });
});

describe('isImmediatelyChained: terminal-state provenance', () => {
  it('is no longer declared as a local function in throwaway-capture.ts', () => {
    const contents = readFileSync(
      join(RULES_DIR, 'throwaway-capture.ts'),
      'utf8'
    );
    expect(contents).not.toMatch(/function isImmediatelyChained\(/);
  });

  it('is exported from capture-chain.ts', () => {
    const contents = readFileSync(join(RULES_DIR, 'capture-chain.ts'), 'utf8');
    expect(contents).toMatch(/export function isImmediatelyChained\(/);
  });
});
