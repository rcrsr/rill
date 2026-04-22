/**
 * Rill Language Tests: Stream Type Parsing (Phase 1)
 * Tests for yield token, YieldNode AST, stream(T):R type constructor parsing,
 * and parse-time enforcement of yield context.
 *
 * Covers: IR-9 (yield parsing), IR-10 (stream type constructor), IC-2 (additive-only)
 */

import { describe, expect, it } from 'vitest';

import { parse, tokenize } from '@rcrsr/rill';

// ============================================================
// IR-10: stream recognized as type name
// ============================================================

describe('Stream Type Registration', () => {
  it('stream is recognized as a valid type name by the parser', () => {
    // If stream is in VALID_TYPE_NAMES, bare 'stream' parses as TypeNameExpr
    const ast = parse('stream');
    const head = ast.statements[0]!.expression.head;
    expect(head.primary.type).toBe('TypeNameExpr');
    expect(head.primary.typeName).toBe('stream');
  });
});

// ============================================================
// IR-9: yield token recognized by lexer
// ============================================================

describe('Yield Token Lexing', () => {
  it('tokenizes yield as YIELD token', () => {
    const tokens = tokenize('yield');
    const yieldToken = tokens.find((t) => t.type === 'YIELD');
    expect(yieldToken).toBeDefined();
    expect(yieldToken!.value).toBe('yield');
  });

  it('does not tokenize yield as IDENTIFIER', () => {
    const tokens = tokenize('yield');
    const identTokens = tokens.filter(
      (t) => t.type === 'IDENTIFIER' && t.value === 'yield'
    );
    expect(identTokens).toHaveLength(0);
  });
});

// ============================================================
// IR-9: yield as bare statement inside stream closure
// ============================================================

describe('Yield Parsing in Stream Closures', () => {
  it('parses bare yield as $ -> yield inside stream closure', () => {
    const ast = parse('|x| yield :stream()');
    const stmt = ast.statements[0]!;
    const closure = stmt.expression.head.primary;
    expect(closure.type).toBe('Closure');

    const body = closure.body;
    expect(body.type).toBe('PipeChain');
    expect(body.terminator).toBeDefined();
    expect(body.terminator!.type).toBe('Yield');

    // Head is implicit pipe var
    expect(body.head.type).toBe('PostfixExpr');
    expect(body.head.primary.type).toBe('Variable');
    expect(body.head.primary.isPipeVar).toBe(true);
  });

  it('parses pipe target yield: expr -> yield inside stream closure', () => {
    const ast = parse('|x| ($x -> yield) :stream()');
    const stmt = ast.statements[0]!;
    const closure = stmt.expression.head.primary;
    expect(closure.type).toBe('Closure');

    const body = closure.body;
    expect(body.type).toBe('GroupedExpr');
    expect(body.expression.terminator).toBeDefined();
    expect(body.expression.terminator!.type).toBe('Yield');
  });

  it('parses yield in block body of stream closure', () => {
    const ast = parse('|x| { $x -> yield } :stream(string)');
    const stmt = ast.statements[0]!;
    const closure = stmt.expression.head.primary;
    expect(closure.type).toBe('Closure');

    const body = closure.body;
    expect(body.type).toBe('Block');
    expect(body.statements).toHaveLength(1);
    expect(body.statements[0]!.expression.terminator!.type).toBe('Yield');
  });

  it('parses yield in stream closure with no-param syntax (||)', () => {
    const ast = parse('|| yield :stream()');
    const stmt = ast.statements[0]!;
    const closure = stmt.expression.head.primary;
    expect(closure.type).toBe('Closure');
    expect(closure.params).toHaveLength(0);
    expect(closure.body.type).toBe('PipeChain');
    expect(closure.body.terminator!.type).toBe('Yield');
  });
});

// ============================================================
// IR-9: yield outside stream closure -> RILL-P006
// ============================================================

describe('Yield Context Enforcement', () => {
  it('throws RILL-P006 for bare yield at top level', () => {
    expect(() => parse('yield')).toThrow('yield');
  });

  it('throws RILL-P006 for pipe yield at top level', () => {
    expect(() => parse('"hello" -> yield')).toThrow('yield');
  });

  it('throws RILL-P006 for yield in closure without stream return type', () => {
    expect(() => parse('|x| yield')).toThrow('yield');
  });

  it('throws RILL-P006 for yield in closure with non-stream return type', () => {
    expect(() => parse('|x| yield :string')).toThrow('yield');
  });

  it('throws RILL-P006 for yield in block of non-stream closure', () => {
    expect(() => parse('|x| { $x -> yield } :number')).toThrow('yield');
  });
});

// ============================================================
// IR-9: yield used as identifier -> RILL-P001
// ============================================================

describe('Yield as Identifier', () => {
  it('throws when yield used in expression position', () => {
    // yield in primary expression position triggers Unexpected keyword error
    // Use a context where yield appears as an operand, not a bare statement
    expect(() => parse('|| (1 + yield) :stream()')).toThrow();
  });
});

// ============================================================
// IR-10: stream() type constructor parsing
// ============================================================

describe('Stream Type Constructor Parsing', () => {
  it('parses stream() with no args', () => {
    const ast = parse('|x| yield :stream()');
    const closure = ast.statements[0]!.expression.head.primary;
    expect(closure.type).toBe('Closure');

    const returnType = closure.returnTypeTarget;
    expect(returnType).toBeDefined();
    expect(returnType!.type).toBe('TypeConstructor');
    expect(returnType!.constructorName).toBe('stream');
    expect(returnType!.args).toHaveLength(0);
  });

  it('parses stream(number) with chunk type', () => {
    const ast = parse('|x| yield :stream(number)');
    const closure = ast.statements[0]!.expression.head.primary;
    const returnType = closure.returnTypeTarget;
    expect(returnType).toBeDefined();
    expect(returnType!.type).toBe('TypeConstructor');
    expect(returnType!.constructorName).toBe('stream');
    expect(returnType!.args).toHaveLength(1);
    expect(returnType!.args[0]!.value).toEqual({
      kind: 'static',
      typeName: 'number',
    });
  });

  it('parses stream(string) with string chunk type', () => {
    const ast = parse('|x| yield :stream(string)');
    const closure = ast.statements[0]!.expression.head.primary;
    const returnType = closure.returnTypeTarget;
    expect(returnType!.constructorName).toBe('stream');
    expect(returnType!.args).toHaveLength(1);
    expect(returnType!.args[0]!.value).toEqual({
      kind: 'static',
      typeName: 'string',
    });
  });

  it('parses stream(number):string with both chunk and resolution types', () => {
    const ast = parse('|x| yield :stream(number):string');
    const closure = ast.statements[0]!.expression.head.primary;
    const returnType = closure.returnTypeTarget;
    expect(returnType).toBeDefined();
    expect(returnType!.type).toBe('TypeConstructor');
    expect(returnType!.constructorName).toBe('stream');
    expect(returnType!.args).toHaveLength(2);

    // First arg: chunk type
    expect(returnType!.args[0]!.value).toEqual({
      kind: 'static',
      typeName: 'number',
    });

    // Second arg: resolution type
    expect(returnType!.args[1]!.value).toEqual({
      kind: 'static',
      typeName: 'string',
    });
  });

  it('parses stream():number with resolution type and no chunk type', () => {
    const ast = parse('|x| yield :stream():number');
    const closure = ast.statements[0]!.expression.head.primary;
    const returnType = closure.returnTypeTarget;
    expect(returnType!.constructorName).toBe('stream');
    // 1 implicit any chunk arg + 1 resolution arg = 2
    expect(returnType!.args).toHaveLength(2);
    expect(returnType!.args[0]!.value).toEqual({
      kind: 'static',
      typeName: 'any',
    });
    expect(returnType!.args[1]!.value).toEqual({
      kind: 'static',
      typeName: 'number',
    });
  });

  it('parses stream(number) in expression position as type constructor', () => {
    const ast = parse('stream(number)');
    const stmt = ast.statements[0]!;
    const head = stmt.expression.head;
    expect(head.type).toBe('PostfixExpr');
    expect(head.primary.type).toBe('TypeConstructor');
    expect(head.primary.constructorName).toBe('stream');
    expect(head.primary.args).toHaveLength(1);
  });

  it('parses bare stream as type name expression', () => {
    const ast = parse('stream');
    const stmt = ast.statements[0]!;
    const head = stmt.expression.head;
    expect(head.type).toBe('PostfixExpr');
    expect(head.primary.type).toBe('TypeNameExpr');
    expect(head.primary.typeName).toBe('stream');
  });

  it('throws RILL-P006 for missing type name after colon in stream type', () => {
    expect(() => parse('|x| yield :stream():')).toThrow(
      "Expected type name after ':' in stream type"
    );
  });
});

// ============================================================
// IR-10: stream type in closure return type (various forms)
// ============================================================

describe('Stream Type in Closure Return Types', () => {
  it('parses closure with :stream() return type (no params)', () => {
    const ast = parse('|| yield :stream()');
    const closure = ast.statements[0]!.expression.head.primary;
    expect(closure.returnTypeTarget!.type).toBe('TypeConstructor');
    expect(closure.returnTypeTarget!.constructorName).toBe('stream');
  });

  it('parses anonymous typed closure with stream return type', () => {
    const ast = parse('|string| yield :stream(number)');
    const closure = ast.statements[0]!.expression.head.primary;
    expect(closure.type).toBe('Closure');
    expect(closure.params).toHaveLength(1);
    expect(closure.params[0]!.name).toBe('$');
    expect(closure.returnTypeTarget!.constructorName).toBe('stream');
  });

  it('parses named param closure with stream return type', () => {
    const ast = parse('|x: string| yield :stream(number):bool');
    const closure = ast.statements[0]!.expression.head.primary;
    expect(closure.type).toBe('Closure');
    expect(closure.params).toHaveLength(1);
    expect(closure.params[0]!.name).toBe('x');

    const returnType = closure.returnTypeTarget!;
    expect(returnType.constructorName).toBe('stream');
    expect(returnType.args).toHaveLength(2);
  });
});

// ============================================================
// IC-2: Additive-only (no existing parse results change)
// ============================================================

describe('IC-2: Non-regression', () => {
  it('break still parses as chain terminator', () => {
    const ast = parse('while (true) do { break }');
    const loop = ast.statements[0]!.expression.head.primary;
    expect(loop.type).toBe('WhileLoop');
    const block = loop.body;
    expect(block.type).toBe('Block');
    expect(block.statements[0]!.expression.terminator!.type).toBe('Break');
  });

  it('return still parses as chain terminator', () => {
    const ast = parse('|x| return');
    const closure = ast.statements[0]!.expression.head.primary;
    expect(closure.body.terminator!.type).toBe('Return');
  });

  it('list() type constructor still parses', () => {
    const ast = parse('list(string)');
    const head = ast.statements[0]!.expression.head;
    expect(head.primary.type).toBe('TypeConstructor');
    expect(head.primary.constructorName).toBe('list');
  });

  it('closure with :string return type still parses', () => {
    const ast = parse('|x| { $x } :string');
    const closure = ast.statements[0]!.expression.head.primary;
    expect(closure.type).toBe('Closure');
    expect(closure.returnTypeTarget).toBeDefined();
    // TypeRef has 'kind' property, not 'type'
    expect((closure.returnTypeTarget as { kind: string }).kind).toBe('static');
    expect((closure.returnTypeTarget as { typeName: string }).typeName).toBe(
      'string'
    );
  });
});
