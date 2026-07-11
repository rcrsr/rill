/**
 * Parser Extension: Script Parsing
 * Script, frontmatter, statements, and annotations
 */

import { Parser } from './parser.js';
import type {
  AnnotatedStatementNode,
  AnnotationArg,
  ExpressionNode,
  RecoveryErrorNode,
  FrontmatterNode,
  NamedArgNode,
  PartialExpressionNode,
  ScriptNode,
  SpreadArgNode,
  StatementNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { isPipeChainNode } from '../ast-nodes.js';
import { LexerError } from '../lexer/index.js';
import {
  check,
  advance,
  expect,
  current,
  isAtEnd,
  skipNewlines,
  makeSpan,
} from './state.js';
import { ERROR_IDS } from '../error-registry.js';

const RESERVED_ANNOTATION_KEYS: readonly string[] = ['type', 'input', 'output'];

// Tokens that open a nested construct tracked by recoverToNextStatement's
// type-matched resync. Angle-bracket forms (destruct<, slice<, use<, retry<,
// do<, pass<, timeout<) are out of scope for v1 and are treated as ordinary
// tokens during resync.
//
// Maps each opening token to the closing token type it expects. Resync
// pushes the expected closer onto a stack on each opening token and pops it
// only when a closer matching the stack top is seen; a closer that doesn't
// match the top is skipped without popping, so a mismatched bracket cannot
// prematurely close the enclosing construct.
const RECOVERY_OPENER_TO_CLOSER: ReadonlyMap<string, string> = new Map([
  [TOKEN_TYPES.LPAREN, TOKEN_TYPES.RPAREN],
  [TOKEN_TYPES.LBRACE, TOKEN_TYPES.RBRACE],
  [TOKEN_TYPES.GUARD_LBRACE, TOKEN_TYPES.RBRACE],
  [TOKEN_TYPES.LBRACKET, TOKEN_TYPES.RBRACKET],
  [TOKEN_TYPES.LIST_LBRACKET, TOKEN_TYPES.RBRACKET],
  [TOKEN_TYPES.DICT_LBRACKET, TOKEN_TYPES.RBRACKET],
  [TOKEN_TYPES.TUPLE_LBRACKET, TOKEN_TYPES.RBRACKET],
  [TOKEN_TYPES.ORDERED_LBRACKET, TOKEN_TYPES.RBRACKET],
]);

const RECOVERY_CLOSING_TOKENS: ReadonlySet<string> = new Set([
  TOKEN_TYPES.RPAREN,
  TOKEN_TYPES.RBRACE,
  TOKEN_TYPES.RBRACKET,
]);

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseScript(): ScriptNode;
    parseFrontmatter(): FrontmatterNode;
    parseStatement(): StatementNode | AnnotatedStatementNode;
    parseAnnotatedStatement(): AnnotatedStatementNode;
    parseAnnotationArgs(): AnnotationArg[];
    parseAnnotationArg(): AnnotationArg;
    recoverToNextStatement(
      startLocation: { line: number; column: number; offset: number },
      message: string
    ): RecoveryErrorNode;
  }
}

// ============================================================
// SCRIPT PARSING
// ============================================================

Parser.prototype.parseScript = function (this: Parser): ScriptNode {
  const start = current(this.state).span.start;
  skipNewlines(this.state);

  // Optional frontmatter
  let frontmatter: FrontmatterNode | null = null;
  if (check(this.state, TOKEN_TYPES.FRONTMATTER_DELIM)) {
    if (this.state.recoveryMode) {
      // Recovery mode: catch errors from unclosed frontmatter and continue
      // with a null frontmatter rather than throwing. The frontmatter scan
      // already consumes to EOF on an unclosed `---`, so no resync is needed.
      try {
        frontmatter = this.parseFrontmatter();
      } catch (err) {
        if (err instanceof ParseError || err instanceof LexerError) {
          const parseError =
            err instanceof ParseError
              ? err
              : new ParseError(
                  ERROR_IDS.RILL_P001,
                  err.message.replace(/ at \d+:\d+$/, ''),
                  err.location
                );
          this.state.errors.push(parseError);
          frontmatter = null;
        } else {
          throw err; // Re-throw non-parse errors
        }
      }
    } else {
      // Normal mode: let errors propagate
      frontmatter = this.parseFrontmatter();
    }
  }
  skipNewlines(this.state);

  // Statements
  const statements: (
    | StatementNode
    | AnnotatedStatementNode
    | RecoveryErrorNode
    | PartialExpressionNode
  )[] = [];
  while (!isAtEnd(this.state)) {
    skipNewlines(this.state);
    if (isAtEnd(this.state)) break;

    if (this.state.recoveryMode) {
      // Recovery mode: catch errors and create RecoveryErrorNode
      const stmtStart = current(this.state).span.start;
      const posBeforeError = this.state.pos;
      try {
        statements.push(this.parseStatement());
      } catch (err) {
        if (err instanceof ParseError || err instanceof LexerError) {
          // Convert LexerError to ParseError for consistency
          const parseError =
            err instanceof ParseError
              ? err
              : new ParseError(
                  ERROR_IDS.RILL_P001,
                  err.message.replace(/ at \d+:\d+$/, ''),
                  err.location
                );
          this.state.errors.push(parseError);
          // Create RecoveryErrorNode and skip to next statement boundary
          const errorNode = this.recoverToNextStatement(
            stmtStart,
            parseError.message
          );
          const boundaryPos = this.state.pos;
          // Attempt to salvage typed sub-expressions from the skipped span
          // before falling back to the opaque RecoveryErrorNode.
          const partialNode = trySalvagePartialExpression(
            this,
            posBeforeError,
            boundaryPos,
            parseError.message
          );
          statements.push(partialNode ?? errorNode);
        } else {
          throw err; // Re-throw non-parse errors
        }
      }
    } else {
      // Normal mode: let errors propagate
      statements.push(this.parseStatement());
    }
    skipNewlines(this.state);
  }

  return {
    type: 'Script',
    frontmatter,
    statements,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.recoverToNextStatement = function (
  this: Parser,
  startLocation: { line: number; column: number; offset: number },
  message: string
): RecoveryErrorNode {
  // Type-matched resync: at an empty stack, a NEWLINE remains the statement
  // boundary. Inside an open {}/()/[] construct, NEWLINE is skipped so
  // recovery advances to the matching closing token instead of stopping
  // at the first interior newline. Bounded by EOF: a construct left
  // unclosed at EOF resyncs there (the loop simply runs out of tokens).
  //
  // A stack of expected closer token types replaces the old shared depth
  // counter: each opening token pushes the closer type it expects, and only
  // a closer matching the stack top pops it. A closer that doesn't match
  // the top is skipped without popping, so e.g. an interior `]` inside an
  // unmatched `(` cannot prematurely close the outer paren.
  const expectedClosers: string[] = [];
  let lastEnd = startLocation;

  while (!isAtEnd(this.state)) {
    if (expectedClosers.length === 0 && check(this.state, TOKEN_TYPES.NEWLINE))
      break;

    const tokenType = current(this.state).type;
    const expectedCloser = RECOVERY_OPENER_TO_CLOSER.get(tokenType);
    const isClosing = RECOVERY_CLOSING_TOKENS.has(tokenType);
    const matchesTop =
      isClosing &&
      expectedClosers.length > 0 &&
      expectedClosers[expectedClosers.length - 1] === tokenType;

    if (expectedCloser !== undefined) {
      expectedClosers.push(expectedCloser);
    } else if (matchesTop) {
      expectedClosers.pop();
    }
    // A closer that doesn't match the stack top is skipped without popping.

    const token = advance(this.state);
    lastEnd = token.span.end;

    // Stop once a matching closer has emptied the stack.
    if (matchesTop && expectedClosers.length === 0) break;
  }

  // `text` is derived from the same offset used for `span`'s end so the
  // two always agree: source.slice(span.start.offset, span.end.offset) === text.
  const text = this.state.source.slice(startLocation.offset, lastEnd.offset);

  return {
    type: 'RecoveryError',
    message,
    text,
    span: makeSpan(startLocation, lastEnd),
  };
};

/**
 * Attempt to salvage typed sub-expressions from the span skipped by
 * recovery. Re-parses expressions starting at `fromPos`, snapshotting and
 * restoring parser state so the attempt never disturbs the resync boundary
 * already established by recoverToNextStatement. Returns null when no
 * typed child could be parsed, in which case the caller falls back to the
 * opaque RecoveryErrorNode.
 */
function trySalvagePartialExpression(
  parser: Parser,
  fromPos: number,
  boundaryPos: number,
  message: string
): PartialExpressionNode | null {
  if (boundaryPos <= fromPos) return null;

  const state = parser.state;
  const errorsBefore = state.errors.length;
  // The progress guard below (state.pos <= before) is what actually bounds
  // this loop; MAX_CHILDREN is only a defensive ceiling against pathological
  // inputs that keep advancing pos without ever reaching boundaryPos.
  const MAX_CHILDREN = 16;
  const children: ExpressionNode[] = [];

  state.pos = fromPos;
  while (state.pos < boundaryPos && children.length < MAX_CHILDREN) {
    const before = state.pos;
    let child: ExpressionNode;
    try {
      child = parser.parseExpression();
    } catch {
      break;
    }
    if (state.pos <= before || state.pos > boundaryPos) {
      // No progress, or the salvage attempt overshot the resync boundary:
      // discard and stop rather than risk desynchronizing from the
      // boundary recoverToNextStatement already established.
      break;
    }
    children.push(child);
  }

  // Discard any parse errors recorded during the salvage attempt; only the
  // original error (already pushed by the caller) should surface.
  state.errors.length = errorsBefore;
  // Always resync to the boundary recoverToNextStatement established,
  // regardless of how far the salvage attempt progressed.
  state.pos = boundaryPos;

  if (children.length === 0) return null;

  return {
    type: 'PartialExpression',
    message,
    children,
    span: makeSpan(
      children[0]!.span.start,
      children[children.length - 1]!.span.end
    ),
  };
}

// ============================================================
// FRONTMATTER PARSING
// ============================================================

Parser.prototype.parseFrontmatter = function (this: Parser): FrontmatterNode {
  const start = current(this.state).span.start;
  const openingDelim = expect(
    this.state,
    TOKEN_TYPES.FRONTMATTER_DELIM,
    'Expected ---'
  );

  // Record position after opening --- (after the delimiter token ends)
  const contentStart = openingDelim.span.end.offset;

  // Skip tokens to find closing ---
  while (
    !check(this.state, TOKEN_TYPES.FRONTMATTER_DELIM) &&
    !isAtEnd(this.state)
  ) {
    advance(this.state);
  }

  // Capture raw source between delimiters
  const contentEnd = current(this.state).span.start.offset;
  const content = this.state.source.slice(contentStart, contentEnd).trim();

  expect(
    this.state,
    TOKEN_TYPES.FRONTMATTER_DELIM,
    'Expected closing ---',
    ERROR_IDS.RILL_P005
  );

  return {
    type: 'Frontmatter',
    content,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// STATEMENT PARSING
// ============================================================

Parser.prototype.parseStatement = function (
  this: Parser
): StatementNode | AnnotatedStatementNode {
  const start = current(this.state).span.start;

  // Check for annotation prefix: ^(...)
  if (check(this.state, TOKEN_TYPES.CARET)) {
    return this.parseAnnotatedStatement();
  }

  // Check for assert statement: assert expression [string-literal]
  if (check(this.state, TOKEN_TYPES.ASSERT)) {
    const assertNode = this.parseAssert();
    return {
      type: 'Statement',
      expression: {
        type: 'PipeChain',
        head: {
          type: 'PostfixExpr',
          primary: assertNode,
          methods: [],
          defaultValue: null,
          span: assertNode.span,
        },
        pipes: [],
        terminator: null,
        span: assertNode.span,
      },
      span: assertNode.span,
    };
  }

  // Check for error statement: error string-literal
  if (check(this.state, TOKEN_TYPES.ERROR)) {
    const errorNode = this.parseError(true); // Require message for statement form
    return {
      type: 'Statement',
      expression: {
        type: 'PipeChain',
        head: {
          type: 'PostfixExpr',
          primary: errorNode,
          methods: [],
          defaultValue: null,
          span: errorNode.span,
        },
        pipes: [],
        terminator: null,
        span: errorNode.span,
      },
      span: errorNode.span,
    };
  }

  // parseExpression() itself only ever produces PipeChainNode on a
  // successful parse; PartialExpressionNode is only emitted by the
  // statement-level recovery salvage in parseScript(), never from here.
  const expression = this.parseExpression();
  if (!isPipeChainNode(expression)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: expected a complete expression in statement',
      start
    );
  }

  return {
    type: 'Statement',
    expression,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// ANNOTATION PARSING
// ============================================================

Parser.prototype.parseAnnotatedStatement = function (
  this: Parser
): AnnotatedStatementNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.CARET, 'Expected ^');
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');

  const annotations = this.parseAnnotationArgs();

  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);
  skipNewlines(this.state);

  // Parse the inner statement (which could also be annotated)
  const statement = this.parseStatement();

  // If inner is already annotated, return it unchanged.
  // BC-2: The immediately-preceding annotation attaches to the closure;
  // the outer annotation is discarded.
  if (statement.type === 'AnnotatedStatement') {
    return statement;
  }

  return {
    type: 'AnnotatedStatement',
    annotations,
    statement,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseAnnotationArgs = function (
  this: Parser
): AnnotationArg[] {
  const args: AnnotationArg[] = [];

  if (check(this.state, TOKEN_TYPES.RPAREN)) {
    return args; // Empty annotation list
  }

  args.push(this.parseAnnotationArg());

  while (check(this.state, TOKEN_TYPES.COMMA)) {
    advance(this.state); // consume comma
    if (check(this.state, TOKEN_TYPES.RPAREN)) break; // trailing comma
    args.push(this.parseAnnotationArg());
  }

  return args;
};

Parser.prototype.parseAnnotationArg = function (this: Parser): AnnotationArg {
  const start = current(this.state).span.start;

  // Spread argument: ...expr
  if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
    advance(this.state); // consume ...
    const expression = this.parseExpression();
    return {
      type: 'SpreadArg',
      expression,
      span: makeSpan(start, current(this.state).span.end),
    } satisfies SpreadArgNode;
  }

  // Description shorthand: bare string expands to description: <string>
  if (check(this.state, TOKEN_TYPES.STRING)) {
    const value = this.parseExpression();
    return {
      type: 'NamedArg',
      name: 'description',
      value,
      span: makeSpan(start, current(this.state).span.end),
    } satisfies NamedArgNode;
  }

  // Named argument: key: value
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected annotation name'
  );
  if (RESERVED_ANNOTATION_KEYS.includes(nameToken.value)) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      `Annotation key "${nameToken.value}" is reserved`,
      nameToken.span.start
    );
  }
  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
  const value = this.parseExpression();

  return {
    type: 'NamedArg',
    name: nameToken.value,
    value,
    span: makeSpan(start, current(this.state).span.end),
  } satisfies NamedArgNode;
};
