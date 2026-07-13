/**
 * LSP semantic-token deltas for a rill document. Classifies each
 * caller-supplied top-level token via core's `TOKEN_HIGHLIGHT_MAP`, splits
 * interpolated triple-quote strings into independently classified
 * sub-tokens, and reclassifies type-name identifiers found inside
 * `TypeNameExpr`/`TypeConstructor` AST nodes.
 */

import {
  TOKEN_HIGHLIGHT_MAP,
  TOKEN_TYPES,
  VALID_TYPE_NAMES,
  tokenize,
  walkAst,
} from '@rcrsr/rill';
import type {
  ASTNode,
  HighlightCategory,
  ParseResult,
  SourceLocation,
  SourceSpan,
  Token,
} from '@rcrsr/rill';
import type { SemanticToken, ServiceTokenType } from './types.js';

/** A classified token with absolute (1-based) source position, prior to delta encoding. */
interface ClassifiedToken {
  readonly span: SourceSpan;
  readonly tokenType: ServiceTokenType;
}

/**
 * Builds `SemanticToken[]` for the given parse result, using the
 * caller-supplied `tokens` and `source` (never re-tokenizes the top level).
 *
 * Tolerates recovery/partial ASTs: never throws. Empty `tokens` yields `[]`.
 */
export function semanticTokens(
  parsed: ParseResult,
  tokens: readonly Token[],
  source: string
): SemanticToken[] {
  if (tokens.length === 0) return [];

  const typeNameSpans = collectTypeNameSpans(parsed.ast);
  const lineStarts = computeLineStarts(source);

  const classified: ClassifiedToken[] = [];
  for (const token of tokens) {
    if (token.type === TOKEN_TYPES.STRING) {
      classified.push(
        ...classifyStringToken(token, source, lineStarts, typeNameSpans)
      );
      continue;
    }
    const category = classifyToken(token, typeNameSpans);
    if (category !== null) {
      classified.push({ span: token.span, tokenType: category });
    }
  }

  return encodeDeltas(classified);
}

// ============================================================
// TYPE-NAME HEURISTIC
// ============================================================

/**
 * Collects the spans of every `TypeNameExpr`/`TypeConstructor` node reachable
 * from `root`. An identifier token whose span falls within one of these spans
 * is reclassified from `variableName` to `typeName`.
 */
function collectTypeNameSpans(root: ASTNode): SourceSpan[] {
  const spans: SourceSpan[] = [];
  walkAst(root, (node) => {
    if (node.type === 'TypeNameExpr' || node.type === 'TypeConstructor') {
      spans.push(node.span);
    }
  });
  return spans;
}

/** True when `span` lies entirely within `outer` (by absolute char offset). */
function isSpanWithin(span: SourceSpan, outer: SourceSpan): boolean {
  return (
    span.start.offset >= outer.start.offset &&
    span.end.offset <= outer.end.offset
  );
}

/** Classifies a single token, applying the type-name heuristic. Returns `null` for unmapped token types. */
function classifyToken(
  token: Token,
  typeNameSpans: readonly SourceSpan[]
): ServiceTokenType | null {
  if (
    token.type === TOKEN_TYPES.IDENTIFIER &&
    (VALID_TYPE_NAMES as readonly string[]).includes(token.value) &&
    typeNameSpans.some((typeSpan) => isSpanWithin(token.span, typeSpan))
  ) {
    return 'typeName';
  }
  const category: HighlightCategory | undefined = TOKEN_HIGHLIGHT_MAP.get(
    token.type
  );
  return category ?? null;
}

// ============================================================
// STRING INTERPOLATION
// ============================================================

/**
 * Classifies a STRING token. Non-interpolated strings emit one `string`
 * sub-token per source line (a multi-line triple-quote string never emits a
 * single token crossing a `\n`, per the LSP per-line delta contract);
 * interpolated triple/single-quote strings are split into literal segments
 * (each themselves split per line) and independently classified `{expr}`
 * sub-tokens carrying absolute columns matching their position in the source.
 */
function classifyStringToken(
  token: Token,
  source: string,
  lineStarts: readonly number[],
  typeNameSpans: readonly SourceSpan[]
): ClassifiedToken[] {
  const raw = source.slice(token.span.start.offset, token.span.end.offset);
  const isTriple = raw.startsWith('"""');
  const quoteLength = isTriple ? 3 : 1;
  const content = raw.slice(quoteLength, raw.length - quoteLength);
  const contentStartOffset = token.span.start.offset + quoteLength;

  if (!containsInterpolation(content, isTriple)) {
    return splitLiteralByLines(raw, token.span.start.offset, lineStarts);
  }

  return splitInterpolatedString(
    content,
    contentStartOffset,
    lineStarts,
    isTriple,
    typeNameSpans
  );
}

/**
 * Splits a literal text run into one `string` sub-token per source line, so
 * no emitted token's span crosses a `\n` boundary. The newline characters
 * themselves are not covered by any emitted token.
 */
function splitLiteralByLines(
  text: string,
  startOffset: number,
  lineStarts: readonly number[]
): ClassifiedToken[] {
  const result: ClassifiedToken[] = [];
  let segStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      if (i > segStart) {
        result.push({
          span: makeSpan(startOffset + segStart, startOffset + i, lineStarts),
          tokenType: 'string',
        });
      }
      segStart = i + 1;
    }
  }
  if (text.length > segStart) {
    result.push({
      span: makeSpan(
        startOffset + segStart,
        startOffset + text.length,
        lineStarts
      ),
      tokenType: 'string',
    });
  }
  return result;
}

/** Checks whether raw string content contains an unescaped interpolation `{`. */
function containsInterpolation(text: string, isTriple: boolean): boolean {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!isTriple && ch === '\\') {
      i += 2;
      continue;
    }
    if (isTriple && ch === '{' && text[i + 1] === '{') {
      i += 2;
      continue;
    }
    if (isTriple && ch === '}' && text[i + 1] === '}') {
      i += 2;
      continue;
    }
    if (ch === '{') return true;
    i++;
  }
  return false;
}

/**
 * Splits interpolated string content into literal-string segments and
 * classified `{expr}` sub-tokens, all carrying absolute source positions.
 */
function splitInterpolatedString(
  content: string,
  contentStartOffset: number,
  lineStarts: readonly number[],
  isTriple: boolean,
  typeNameSpans: readonly SourceSpan[]
): ClassifiedToken[] {
  const result: ClassifiedToken[] = [];
  let i = 0;
  let segStart = 0;

  const flushStringSeg = (end: number): void => {
    if (end > segStart) {
      result.push(
        ...splitLiteralByLines(
          content.slice(segStart, end),
          contentStartOffset + segStart,
          lineStarts
        )
      );
    }
  };

  while (i < content.length) {
    const ch = content[i];

    if (!isTriple && ch === '\\') {
      i += 2;
      continue;
    }
    if (isTriple && ch === '{' && content[i + 1] === '{') {
      i += 2;
      continue;
    }
    if (isTriple && ch === '}' && content[i + 1] === '}') {
      i += 2;
      continue;
    }

    if (ch === '{') {
      flushStringSeg(i);

      const lbraceOffset = contentStartOffset + i;
      result.push({
        span: makeSpan(lbraceOffset, lbraceOffset + 1, lineStarts),
        tokenType: 'bracket',
      });
      i++;

      let depth = 1;
      let j = i;
      while (j < content.length && depth > 0) {
        const c = content[j];
        if (!isTriple && c === '\\') {
          j += 2;
          continue;
        }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        if (depth > 0) j++;
      }

      if (depth !== 0) {
        const restStart = i;
        if (content.length > restStart) {
          result.push(
            ...splitLiteralByLines(
              content.slice(restStart),
              contentStartOffset + restStart,
              lineStarts
            )
          );
        }
        return result;
      }

      const exprText = content.slice(i, j);
      const exprAbsOffset = contentStartOffset + i;
      result.push(
        ...tokenizeInterpolatedExpression(
          exprText,
          exprAbsOffset,
          lineStarts,
          typeNameSpans
        )
      );

      const rbraceOffset = contentStartOffset + j;
      result.push({
        span: makeSpan(rbraceOffset, rbraceOffset + 1, lineStarts),
        tokenType: 'bracket',
      });

      i = j + 1;
      segStart = i;
      continue;
    }

    i++;
  }

  flushStringSeg(content.length);
  return result;
}

/**
 * Re-tokenizes a single `{expr}` interpolation slice via core `tokenize`,
 * the one carved exception to the top-level no-retokenize rule. Falls back
 * to a single `variableName` sub-token spanning the expression if
 * tokenization throws.
 */
function tokenizeInterpolatedExpression(
  exprText: string,
  exprAbsOffset: number,
  lineStarts: readonly number[],
  typeNameSpans: readonly SourceSpan[]
): ClassifiedToken[] {
  const baseLocation = offsetToLocation(exprAbsOffset, lineStarts);

  try {
    const innerTokens = tokenize(exprText, baseLocation, {
      includeComments: true,
    });
    const result: ClassifiedToken[] = [];
    for (const inner of innerTokens) {
      if (
        inner.type === TOKEN_TYPES.EOF ||
        inner.type === TOKEN_TYPES.NEWLINE
      ) {
        continue;
      }
      const category = classifyToken(inner, typeNameSpans);
      if (category !== null) {
        result.push({ span: inner.span, tokenType: category });
      }
    }
    return result;
  } catch {
    return [
      {
        span: {
          start: baseLocation,
          end: offsetToLocation(exprAbsOffset + exprText.length, lineStarts),
        },
        tokenType: 'variableName',
      },
    ];
  }
}

// ============================================================
// OFFSET / LOCATION CONVERSION
// ============================================================

/** Computes the 0-based char offset at which each line starts, for offset-to-location conversion. */
function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** Converts an absolute 0-based char offset into a 1-based `SourceLocation`. */
function offsetToLocation(
  offset: number,
  lineStarts: readonly number[]
): SourceLocation {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  const lineStart = lineStarts[low]!;
  return { line: low + 1, column: offset - lineStart + 1, offset };
}

function makeSpan(
  startOffset: number,
  endOffset: number,
  lineStarts: readonly number[]
): SourceSpan {
  return {
    start: offsetToLocation(startOffset, lineStarts),
    end: offsetToLocation(endOffset, lineStarts),
  };
}

// ============================================================
// LSP DELTA ENCODING
// ============================================================

/** Converts absolute-position classified tokens into LSP relative (delta) encoding. */
function encodeDeltas(tokens: readonly ClassifiedToken[]): SemanticToken[] {
  const result: SemanticToken[] = [];
  let prevLine = 0;
  let prevStart = 0;

  for (const token of tokens) {
    const line = token.span.start.line - 1;
    const start = token.span.start.column - 1;
    const length = token.span.end.offset - token.span.start.offset;

    const deltaLine = line - prevLine;
    const deltaStart = deltaLine === 0 ? start - prevStart : start;

    result.push({
      deltaLine,
      deltaStart,
      length,
      tokenType: token.tokenType,
      tokenModifiers: 0,
    });

    prevLine = line;
    prevStart = start;
  }

  return result;
}
