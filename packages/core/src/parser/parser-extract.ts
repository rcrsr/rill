/**
 * Parser Extension: Extraction Operator Parsing
 * Destructure, slice
 */

import { Parser } from './parser.js';
import type {
  DestructNode,
  DestructPatternNode,
  DestructureNode,
  SliceBoundNode,
  SliceNode,
  TypeRef,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan } from './state.js';
import { isDictStart, isNegativeNumber } from './helpers.js';
import { parseTypeRef } from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseDestructure(): DestructureNode;
    parseDestructPattern(): DestructPatternNode;
    parseDestructTarget(): DestructNode;
    parseSlice(): SliceNode;
    parseSliceBound(): SliceBoundNode;
  }
}

// ============================================================
// DESTRUCTURE
// ============================================================

Parser.prototype.parseDestructure = function (this: Parser): DestructureNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.DESTRUCT_LANGLE, 'Expected destruct<');

  const elements: DestructPatternNode[] = [];
  if (!check(this.state, TOKEN_TYPES.GT)) {
    elements.push(this.parseDestructPattern());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      if (check(this.state, TOKEN_TYPES.GT)) break;
      elements.push(this.parseDestructPattern());
    }
  }

  expect(this.state, TOKEN_TYPES.GT, 'Expected >', ERROR_IDS.RILL_P005);

  return {
    type: 'Destructure',
    elements,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseDestructPattern = function (
  this: Parser
): DestructPatternNode {
  const start = current(this.state).span.start;

  if (check(this.state, TOKEN_TYPES.DESTRUCT_LANGLE)) {
    const nested = this.parseDestructure();
    return {
      type: 'DestructPattern',
      kind: 'nested',
      name: null,
      key: null,
      typeRef: null,
      nested,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    current(this.state).value === '_'
  ) {
    advance(this.state);
    return {
      type: 'DestructPattern',
      kind: 'skip',
      name: null,
      key: null,
      typeRef: null,
      nested: null,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  if (isDictStart(this.state)) {
    const keyToken = advance(this.state);
    advance(this.state);
    expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
    const nameToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected variable name'
    );

    let typeRef: TypeRef | null = null;
    if (check(this.state, TOKEN_TYPES.COLON)) {
      advance(this.state);
      typeRef = parseTypeRef(this.state);
    }

    return {
      type: 'DestructPattern',
      kind: 'keyValue',
      name: nameToken.value,
      key: keyToken.value,
      typeRef,
      nested: null,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $, identifier:, or _');
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected variable name'
  );

  let typeRef: TypeRef | null = null;
  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    typeRef = parseTypeRef(this.state);
  }

  return {
    type: 'DestructPattern',
    kind: 'variable',
    name: nameToken.value,
    key: null,
    typeRef,
    nested: null,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// DESTRUCT (keyword form)
// ============================================================

Parser.prototype.parseDestructTarget = function (this: Parser): DestructNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.DESTRUCT_LANGLE, 'Expected destruct<');

  const elements: DestructPatternNode[] = [];
  if (!check(this.state, TOKEN_TYPES.GT)) {
    elements.push(this.parseDestructPattern());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      if (check(this.state, TOKEN_TYPES.GT)) break;
      elements.push(this.parseDestructPattern());
    }
  }

  expect(
    this.state,
    TOKEN_TYPES.GT,
    "expected '>' to close destruct form",
    ERROR_IDS.RILL_P005
  );

  return {
    type: 'Destruct',
    elements,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// SLICE
// ============================================================

Parser.prototype.parseSlice = function (this: Parser): SliceNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.SLICE_LANGLE, 'Expected slice<');

  // EC-8: slice<> with no ':' separator is an error
  if (check(this.state, TOKEN_TYPES.GT)) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      "slice requires at least one ':' separator",
      current(this.state).span.start
    );
  }

  let sliceStart: SliceBoundNode | null = null;
  let sliceStop: SliceBoundNode | null = null;
  let sliceStep: SliceBoundNode | null = null;

  // Handle :: as shorthand for empty start and stop (e.g., slice<::2> means [::2])
  if (check(this.state, TOKEN_TYPES.DOUBLE_COLON)) {
    advance(this.state); // consume ::
    if (!check(this.state, TOKEN_TYPES.GT)) {
      sliceStep = this.parseSliceBound();
    }
  } else {
    if (!check(this.state, TOKEN_TYPES.COLON)) {
      sliceStart = this.parseSliceBound();
    }

    if (!check(this.state, TOKEN_TYPES.COLON)) {
      throw new ParseError(
        ERROR_IDS.RILL_P001,
        "slice requires at least one ':' separator",
        current(this.state).span.start
      );
    }

    advance(this.state); // consume first :

    if (
      !check(this.state, TOKEN_TYPES.COLON) &&
      !check(this.state, TOKEN_TYPES.GT)
    ) {
      sliceStop = this.parseSliceBound();
    }

    if (check(this.state, TOKEN_TYPES.COLON)) {
      advance(this.state);
      if (!check(this.state, TOKEN_TYPES.GT)) {
        sliceStep = this.parseSliceBound();
      }
    }
  }

  expect(
    this.state,
    TOKEN_TYPES.GT,
    "expected '>' to close slice form",
    ERROR_IDS.RILL_P005
  );

  return {
    type: 'Slice',
    start: sliceStart,
    stop: sliceStop,
    step: sliceStep,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseSliceBound = function (this: Parser): SliceBoundNode {
  if (isNegativeNumber(this.state)) {
    const start = current(this.state).span.start;
    advance(this.state);
    const numToken = advance(this.state);
    return {
      type: 'NumberLiteral',
      value: -parseFloat(numToken.value),
      span: makeSpan(start, numToken.span.end),
    };
  }

  if (check(this.state, TOKEN_TYPES.NUMBER)) {
    const token = advance(this.state);
    return {
      type: 'NumberLiteral',
      value: parseFloat(token.value),
      span: token.span,
    };
  }

  if (check(this.state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
    return this.parseVariable();
  }

  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    return this.parseGrouped();
  }

  throw new ParseError(
    ERROR_IDS.RILL_P001,
    `Expected slice bound (number, variable, or grouped expression), got: ${current(this.state).value}`,
    current(this.state).span.start
  );
};
