/**
 * Parser Extension: Script Parsing
 * Script, frontmatter, statements, and annotations
 */

import { Parser } from './parser.js';
import type {
  AnnotatedStatementNode,
  AnnotationArg,
  RecoveryErrorNode,
  FrontmatterNode,
  NamedArgNode,
  ScriptNode,
  SpreadArgNode,
  StatementNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
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
    frontmatter = this.parseFrontmatter();
  }
  skipNewlines(this.state);

  // Statements
  const statements: (
    | StatementNode
    | AnnotatedStatementNode
    | RecoveryErrorNode
  )[] = [];
  while (!isAtEnd(this.state)) {
    skipNewlines(this.state);
    if (isAtEnd(this.state)) break;

    if (this.state.recoveryMode) {
      // Recovery mode: catch errors and create RecoveryErrorNode
      const stmtStart = current(this.state).span.start;
      try {
        statements.push(this.parseStatement());
      } catch (err) {
        if (err instanceof ParseError || err instanceof LexerError) {
          // Convert LexerError to ParseError for consistency
          const parseError =
            err instanceof ParseError
              ? err
              : new ParseError(
                  err.message.replace(/ at line \d+, column \d+$/, ''),
                  err.location
                );
          this.state.errors.push(parseError);
          // Create RecoveryErrorNode and skip to next statement boundary
          const errorNode = this.recoverToNextStatement(
            stmtStart,
            parseError.message
          );
          statements.push(errorNode);
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
  const startOffset = startLocation.offset;
  let endOffset = startOffset;

  // Skip tokens until we hit a newline or EOF (statement boundary)
  while (!isAtEnd(this.state) && !check(this.state, TOKEN_TYPES.NEWLINE)) {
    endOffset = current(this.state).span.end.offset;
    advance(this.state);
  }

  // Extract the skipped text from source
  const text = this.state.source.slice(startOffset, endOffset);

  return {
    type: 'RecoveryError',
    message,
    text,
    span: makeSpan(startLocation, current(this.state).span.start),
  };
};

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

  expect(this.state, TOKEN_TYPES.FRONTMATTER_DELIM, 'Expected closing ---');

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
          span: errorNode.span,
        },
        pipes: [],
        terminator: null,
        span: errorNode.span,
      },
      span: errorNode.span,
    };
  }

  const expression = this.parseExpression();

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

  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');

  // Parse the inner statement (which could also be annotated)
  const statement = this.parseStatement();

  // If inner is annotated, wrap it; otherwise use directly
  const innerStatement: StatementNode =
    statement.type === 'AnnotatedStatement'
      ? {
          type: 'Statement',
          expression: statement.statement.expression,
          span: statement.span,
        }
      : statement;

  return {
    type: 'AnnotatedStatement',
    annotations,
    statement: innerStatement,
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

  // Spread argument: *expr
  if (check(this.state, TOKEN_TYPES.STAR)) {
    advance(this.state); // consume *
    const expression = this.parseExpression();
    return {
      type: 'SpreadArg',
      expression,
      span: makeSpan(start, current(this.state).span.end),
    } satisfies SpreadArgNode;
  }

  // Named argument: key: value
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected annotation name'
  );
  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
  const value = this.parseExpression();

  return {
    type: 'NamedArg',
    name: nameToken.value,
    value,
    span: makeSpan(start, current(this.state).span.end),
  } satisfies NamedArgNode;
};
