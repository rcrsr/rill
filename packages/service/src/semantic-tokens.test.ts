import { describe, expect, it } from 'vitest';
import { parseWithRecovery, tokenize, walkAst } from '@rcrsr/rill';
import type { SemanticToken } from './types.js';
import { semanticTokens } from './semantic-tokens.js';

/** Decodes LSP relative-encoded tokens back into absolute 0-based positions for assertions. */
function decodeAbsolute(tokens: readonly SemanticToken[]): {
  line: number;
  character: number;
  length: number;
  tokenType: SemanticToken['tokenType'];
}[] {
  const result: {
    line: number;
    character: number;
    length: number;
    tokenType: SemanticToken['tokenType'];
  }[] = [];
  let line = 0;
  let character = 0;
  for (const token of tokens) {
    line += token.deltaLine;
    character =
      token.deltaLine === 0 ? character + token.deltaStart : token.deltaStart;
    result.push({
      line,
      character,
      length: token.length,
      tokenType: token.tokenType,
    });
  }
  return result;
}

/** Computes the 0-based char offset at which each line starts, for decoding (line, character) back to a source offset. */
function computeLineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

describe('semanticTokens', () => {
  it('sub-tokenizes interpolated triple-quote strings with absolute columns matching the source', () => {
    const source = '"""Hello {$name}, you are {$age}!"""';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const tokens = tokenize(source);
    const result = semanticTokens(parsed, tokens, source);
    const decoded = decodeAbsolute(result);

    const nameDollarCol = source.indexOf('$name');
    const nameIdentCol = nameDollarCol + 1;
    const ageDollarCol = source.indexOf('$age');
    const ageIdentCol = ageDollarCol + 1;

    const nameDollarToken = decoded.find(
      (t) => t.line === 0 && t.character === nameDollarCol
    );
    const nameIdentToken = decoded.find(
      (t) => t.line === 0 && t.character === nameIdentCol
    );
    const ageDollarToken = decoded.find(
      (t) => t.line === 0 && t.character === ageDollarCol
    );
    const ageIdentToken = decoded.find(
      (t) => t.line === 0 && t.character === ageIdentCol
    );

    expect(nameDollarToken?.tokenType).toBe('variableName');
    expect(nameIdentToken?.tokenType).toBe('variableName');
    expect(nameIdentToken?.length).toBe('name'.length);
    expect(ageDollarToken?.tokenType).toBe('variableName');
    expect(ageIdentToken?.tokenType).toBe('variableName');
    expect(ageIdentToken?.length).toBe('age'.length);

    // Literal segments around the interpolations classify independently as strings.
    const helloCol = source.indexOf('Hello');
    const helloToken = decoded.find(
      (t) => t.line === 0 && t.character === helloCol
    );
    expect(helloToken?.tokenType).toBe('string');
  });

  it('reclassifies a type-name identifier inside a type constructor while the same identifier used as a value stays variableName', () => {
    const source = 'list(string) => $t\ndict[string: 5] => $d';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    let sawTypeConstructor = false;
    walkAst(parsed.ast, (node) => {
      if (node.type === 'TypeConstructor') sawTypeConstructor = true;
    });
    expect(sawTypeConstructor).toBe(true);

    const tokens = tokenize(source);
    const result = semanticTokens(parsed, tokens, source);
    const decoded = decodeAbsolute(result);

    const firstStringCol = source.indexOf('string');
    const secondStringCol = source.indexOf('string', firstStringCol + 1);
    expect(secondStringCol).toBeGreaterThan(firstStringCol);

    const typeUsageToken = decoded.find(
      (t) => t.line === 0 && t.character === firstStringCol
    );
    const valueUsageToken = decoded.find(
      (t) =>
        t.line === 1 &&
        t.character === secondStringCol - source.indexOf('\n') - 1
    );

    expect(typeUsageToken?.tokenType).toBe('typeName');
    expect(valueUsageToken?.tokenType).toBe('variableName');
  });

  it('tolerates a recovery/partial AST without throwing', () => {
    const source = '1 -> $x -> ';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(false);

    const tokens = tokenize(source);
    expect(() => semanticTokens(parsed, tokens, source)).not.toThrow();
    const result = semanticTokens(parsed, tokens, source);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns an empty array for empty source and tokens', () => {
    const source = '';
    const parsed = parseWithRecovery(source);
    const tokens = tokenize(source).filter((t) => t.type !== 'EOF');

    expect(semanticTokens(parsed, tokens, source)).toEqual([]);
  });

  it('emits a single string token for a non-interpolated string', () => {
    const source = '"plain text"';
    const parsed = parseWithRecovery(source);
    const tokens = tokenize(source);

    const result = semanticTokens(parsed, tokens, source);
    const stringTokens = result.filter((t) => t.tokenType === 'string');
    expect(stringTokens).toHaveLength(1);
    expect(stringTokens[0]?.length).toBe(source.length);
  });

  it('never emits a token crossing a line boundary for a multi-line triple-quote string without interpolation', () => {
    const source = '"""Hello\nWorld\nfoo"""';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const tokens = tokenize(source);
    const result = semanticTokens(parsed, tokens, source);
    const decoded = decodeAbsolute(result);
    const lineStartOffsets = computeLineStartOffsets(source);

    expect(decoded.length).toBeGreaterThan(0);
    for (const token of decoded) {
      const offset = lineStartOffsets[token.line]! + token.character;
      const covered = source.slice(offset, offset + token.length);
      expect(covered).not.toContain('\n');
    }
  });

  it('never emits a token crossing a line boundary for a multi-line triple-quote string with an adjacent interpolation', () => {
    const source = '"""Hello\nWorld {$name}\nfoo"""';
    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const tokens = tokenize(source);
    const result = semanticTokens(parsed, tokens, source);
    const decoded = decodeAbsolute(result);
    const lineStartOffsets = computeLineStartOffsets(source);

    expect(decoded.length).toBeGreaterThan(0);
    for (const token of decoded) {
      const offset = lineStartOffsets[token.line]! + token.character;
      const covered = source.slice(offset, offset + token.length);
      expect(covered).not.toContain('\n');
    }

    const nameIdentCol = source.indexOf('name');
    const nameLine = source.slice(0, nameIdentCol).split('\n').length - 1;
    const nameToken = decoded.find(
      (t) =>
        t.line === nameLine &&
        t.character === nameIdentCol - lineStartOffsets[nameLine]!
    );
    expect(nameToken?.tokenType).toBe('variableName');
  });
});
