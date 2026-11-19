/**
 * Rill Runtime Tests: fn parameter and signature edges
 *
 * Duplicate param names, deep outer-type chains, interpolated signature
 * defaults, the dynamic outer in type position, and the diagnostics for
 * reflex forms that rill does not accept.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import { parseSignatureRegistration } from '../../src/signature-parser.js';
import { run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

function parseErrorOf(source: string): ParseError {
  try {
    parse(source);
  } catch (err) {
    if (err instanceof ParseError) return err;
    throw err;
  }
  throw new Error(`expected a parse error for: ${source}`);
}

describe('fn param names', () => {
  it('rejects a repeated named param in an fn literal with RILL-P027', () => {
    const err = parseErrorOf('fn(x: number, x: string) { $x }');
    expect(err.errorId).toBe('RILL-P027');
    expect(err.message).toContain("Duplicate key 'x' in fn parameter list");
  });

  it('rejects a repeated named param in an fn type with RILL-P027', () => {
    expect(parseErrorOf('fn(x, x) => $t').errorId).toBe('RILL-P027');
  });

  it('rejects a repeated named param in a host signature', () => {
    expect(() =>
      parseSignatureRegistration('fn(a: number, a: number)', 'f')
    ).toThrow(/Duplicate key 'a' in fn parameter list/);
  });

  it('accepts a brand-key param name, which binds a variable only', async () => {
    expect(
      await run('fn(__rill_type: number) { $__rill_type } => $f\n$f(3)')
    ).toBe(3);
  });

  it('names a mismatched default as a parameter', async () => {
    await expectHaltMessage(
      () => run('fn(x: number = "a") { $x }'),
      "Default value for parameter 'x' must be number, got string"
    );
  });
});

describe('fn outer type', () => {
  it('halts with RILL-P015 on a deep fn outer chain, not a stack overflow', () => {
    const source = '1 -> :' + 'fn:'.repeat(6000) + 'number';
    expect(parseErrorOf(source).errorId).toBe('RILL-P015');
  });

  it('halts with RILL-P015 on a deep stream outer chain', () => {
    const source = '1 -> :' + 'stream:'.repeat(6000) + 'number';
    expect(parseErrorOf(source).errorId).toBe('RILL-P015');
  });

  it('wraps a deep signature chain in the registration error', () => {
    expect(() =>
      parseSignatureRegistration('fn:'.repeat(6000) + 'number', 'f')
    ).toThrow(/Invalid signature for function 'f'/);
  });

  it('accepts a $var outer in type position', async () => {
    expect(
      await run('number => $t\nfn(x):$t { 1 } => $f\n$f -> :fn(x):$t\ntrue')
    ).toBe(true);
  });
});

describe('host signature defaults', () => {
  it('rejects an interpolated string default', () => {
    expect(() =>
      parseSignatureRegistration('fn(x: string = "ab{1}"):string', 'f')
    ).toThrow(
      /parameter 'x' default must be a string, number, or bool literal/
    );
  });

  it('keeps a plain string default', () => {
    const parsed = parseSignatureRegistration(
      'fn(x: string = "ab"):string',
      'f'
    );
    expect(parsed.params[0]?.defaultValue).toBe('ab');
  });

  it('names the fn signature form for a removed |params| signature', () => {
    expect(() => parseSignatureRegistration('|x: string|:string', 'f')).toThrow(
      /write fn\(x: string\):string/
    );
  });
});

describe('reflex diagnostics', () => {
  it('reports a named fn declaration with the capture form', () => {
    const err = parseErrorOf('fn double(x) { $x }');
    expect(err.errorId).toBe('RILL-P001');
    expect(err.message).toContain('=> $double');
  });
});
