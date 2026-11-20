/**
 * Parser Extension: Pipe Targets
 * Pipe-target parsing and the postfix dispatch helpers it shares
 */

import { Parser } from './parser.js';
import type {
  AnnotationAccessNode,
  DeclarationNode,
  DoWhileLoopNode,
  WhileLoopNode,
  HostCallNode,
  IndexAccessNode,
  MethodCallNode,
  PassBlockNode,
  TimeoutBlockNode,
  DictNode,
  ListLiteralNode,
  ExistenceCheck,
  PipeTargetNode,
  PostfixExprNode,
  SourceLocation,
  SourceSpan,
  FnTypeNode,
  TypeConstructorNode,
  TypeNameExprNode,
  TypeRef,
  VariableNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  isAtEnd,
  makeSpan,
  peek,
  skipNewlinesIfFollowedBy,
} from './state.js';
import {
  isHostCall,
  isClosureCallWithAccess,
  canStartPipeInvoke,
  isAnnotationAccess,
  isMethodCall,
  isFnStart,
  rejectRemovedClosureLiteral,
  parseBareHostCall,
  describeToken,
} from './helpers.js';
import {
  parseScriptTypeRef,
  throwBareUnion,
  throwRemovedClosureType,
} from './parser-types.js';
import { atTypeConstructor } from './parser-shape.js';
import { ERROR_IDS } from '../error-registry.js';
import { removedSelectorError } from './parser-variables.js';
import {
  codeBlockShape,
  isRillTypeName,
  readsPipeValue,
  type ASTNode,
} from '../types.js';
import {
  postfixDispatchTable,
  type PostfixLoopState,
} from './parser-primary.js';

/**
 * Builds a phantom `$` pipe-variable primary node, used as the receiver when
 * wrapping a chain of methods (`-> .a.b`, `-> .a?`, `-> .a ?? default`) that
 * has no explicit primary of its own.
 */
function makePipeVarPrimary(span: SourceSpan): VariableNode {
  return {
    type: 'Variable',
    name: null,
    isPipeVar: true,
    accessChain: [],
    defaultValue: null,
    existenceCheck: null,
    span,
  };
}

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parsePipeTarget(): PipeTargetNode;
    parsePipeTargetDot(): PipeTargetNode;
    parsePipeTargetBracket(): PipeTargetNode;
    parsePipeTargetDictLiteral(): PipeTargetNode;
  }
}

// ============================================================
// PIPE TARGET DISPATCH TABLE AND HANDLERS
// ============================================================

// Handler: -> .method(...) or -> .^annotation  (possibly chained)
Parser.prototype.parsePipeTargetDot = function (this: Parser): PipeTargetNode {
  const methods: (MethodCallNode | AnnotationAccessNode | IndexAccessNode)[] =
    [];
  const start = current(this.state).span.start;

  // Collect all chained method calls, annotation accesses, and bracket
  // indexes. A newline is only skipped when the next real token is a dot,
  // so the chain can continue on the next line (`-> .trim\n  .upper`)
  // without consuming newlines that belong to a following statement.
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
  while (
    check(this.state, TOKEN_TYPES.DOT) ||
    check(this.state, TOKEN_TYPES.LBRACKET)
  ) {
    if (check(this.state, TOKEN_TYPES.LBRACKET)) {
      const openBracket = advance(this.state); // consume [
      const index = this.parsePipeChain();
      const closeBracket = expect(
        this.state,
        TOKEN_TYPES.RBRACKET,
        'Expected ] after index expression',
        ERROR_IDS.RILL_P005
      );
      methods.push({
        type: 'IndexAccess',
        index,
        span: makeSpan(openBracket.span.start, closeBracket.span.end),
      });
    } else if (isAnnotationAccess(this.state)) {
      const dotStart = current(this.state).span.start;
      advance(this.state); // consume .
      advance(this.state); // consume ^
      // A trailing `^` at end of line continues onto the annotation key on
      // the next line.
      skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.IDENTIFIER);
      const nameToken = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected annotation key after .^'
      );
      methods.push({
        type: 'AnnotationAccess',
        key: nameToken.value,
        span: makeSpan(dotStart, nameToken.span.end),
      });
    } else {
      // `-> .(` and `-> .{` are the removed selectors, not a method call.
      const afterDot = this.state.tokens[this.state.pos + 1]?.type;
      if (afterDot === TOKEN_TYPES.LPAREN || afterDot === TOKEN_TYPES.LBRACE) {
        throw removedSelectorError(
          afterDot === TOKEN_TYPES.LPAREN ? '.(' : '.{',
          current(this.state).span.start
        );
      }
      methods.push(this.parseMethodCall(null));
    }
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
  }

  const firstSpan = methods[0]?.span ?? makeSpan(start, start);

  if (check(this.state, TOKEN_TYPES.QUESTION)) {
    const postfixExpr: PostfixExprNode = {
      type: 'PostfixExpr',
      primary: makePipeVarPrimary(firstSpan),
      methods,
      defaultValue: null,
      span: makeSpan(start, previous(this.state).span.end),
    };
    return this.parseConditionalWithCondition(postfixExpr);
  }

  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    advance(this.state);
    const defaultValue = this.parseDefaultValue();
    return {
      type: 'PostfixExpr',
      primary: makePipeVarPrimary(firstSpan),
      methods,
      defaultValue,
      span: makeSpan(start, defaultValue.span.end),
    };
  }

  // Single method: return as-is. The first entry is always a MethodCallNode
  // or AnnotationAccessNode — dispatch into this function only happens on a
  // leading DOT token, so an IndexAccessNode (which can only follow a
  // preceding method/annotation) can never be the sole entry.
  const [only] = methods;
  if (
    methods.length === 1 &&
    only !== undefined &&
    only.type !== 'IndexAccess'
  ) {
    return only;
  }

  // Multiple methods: wrap in PostfixExpr with $ as primary
  return {
    type: 'PostfixExpr',
    primary: makePipeVarPrimary(firstSpan),
    methods,
    defaultValue: null,
    span: makeSpan(start, previous(this.state).span.end),
  };
};

/**
 * Attaches a trailing `?? default` to a list or dict literal pipe target.
 * The default is the value dispatched when the piped value selects nothing.
 * The node's span grows to cover the default.
 */
function withDispatchDefault<T extends ListLiteralNode | DictNode>(
  parser: Parser,
  node: T
): T {
  if (!check(parser.state, TOKEN_TYPES.NULLISH_COALESCE)) return node;
  advance(parser.state);
  const defaultValue = parser.parseDefaultValue();
  return {
    ...node,
    defaultValue,
    span: makeSpan(node.span.start, defaultValue.span.end),
  };
}

// Handler: -> [...] — bare bracket literal (tuple or dict) with optional nullish coalesce
Parser.prototype.parsePipeTargetBracket = function (
  this: Parser
): PipeTargetNode {
  return withDispatchDefault(this, this.parseTupleOrDict());
};

// Handler: -> dict[...] — keyword-prefixed dict literal with optional nullish coalesce
Parser.prototype.parsePipeTargetDictLiteral = function (
  this: Parser
): PipeTargetNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume dict[
  return withDispatchDefault(this, this.parseKeywordCollectionBody(start));
};

// Dispatch table for parsePipeTarget. Single-token forms only.
// Inline guards handle multi-token conditions before this table is checked.
// Not exported — file-local.
const pipeTargetDispatchTable: Record<
  string,
  (this: Parser) => PipeTargetNode
> = {
  [TOKEN_TYPES.ASSERT]: function (this: Parser) {
    return this.parseAssert();
  },
  [TOKEN_TYPES.ERROR]: function (this: Parser) {
    return this.parseError();
  },
  [TOKEN_TYPES.COLON]: function (this: Parser) {
    return this.parseTypeOperation();
  },
  [TOKEN_TYPES.DESTRUCT_LANGLE]: function (this: Parser) {
    return this.parseDestructTarget();
  },
  [TOKEN_TYPES.SLICE_LANGLE]: function (this: Parser) {
    return this.parseSlice();
  },
  [TOKEN_TYPES.USE_LANGLE]: function (this: Parser) {
    return this.parseUseExpr();
  },
  [TOKEN_TYPES.PASS_LANGLE]: function (this: Parser) {
    return attachPipeTargetPostfixChain.call(this, this.parsePassBlock());
  },
  [TOKEN_TYPES.TIMEOUT_LANGLE]: function (this: Parser) {
    return attachPipeTargetPostfixChain.call(this, this.parseTimeoutBlock());
  },
  [TOKEN_TYPES.PASS]: function (this: Parser) {
    const token = advance(this.state);
    // Bracketless body form: -> pass { body }
    if (check(this.state, TOKEN_TYPES.LBRACE)) {
      const emptyOptions: DictNode = {
        type: 'Dict',
        entries: [],
        defaultValue: null,
        span: makeSpan(token.span.end, token.span.end),
      };
      const body = this.parseBlock(true);
      const passBlock: PassBlockNode = {
        type: 'PassBlock',
        options: emptyOptions,
        body,
        span: makeSpan(token.span.start, body.span.end),
      };
      return attachPipeTargetPostfixChain.call(this, passBlock);
    }
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "'pass' as a pipe target requires a body block; use 'pass { body }' or 'pass<on_error: #IGNORE> { body }'",
      token.span.start
    );
  },
  [TOKEN_TYPES.DOT]: function (this: Parser): PipeTargetNode {
    return this.parsePipeTargetDot();
  },
  // Bare presence probe on the piped value: `$value -> .?`. Mirrors the
  // postfix DOT_QUESTION handling in runPostfixDispatchLoop, but here the
  // receiver is the implicit pipe var rather than an accumulated primary.
  // A field/key may still follow (`-> .?field`); only the fieldless form is
  // handled inline since a following field turns this into a two-token
  // chain identical to parsePipeTargetDot's shape.
  [TOKEN_TYPES.DOT_QUESTION]: function (this: Parser): PipeTargetNode {
    const dotToken = advance(this.state);
    const finalAccess = this.parseExistenceAccess(dotToken.span.start);
    if (!finalAccess) {
      if (!check(this.state, TOKEN_TYPES.NEWLINE) && !isAtEnd(this.state)) {
        throw new ParseError(
          ERROR_IDS.RILL_P006,
          "Expected field name after '.?'",
          dotToken.span.start
        );
      }
    }
    let typeRef: ExistenceCheck['typeRef'] = null;
    if (check(this.state, TOKEN_TYPES.AMPERSAND)) {
      advance(this.state);
      typeRef = parseScriptTypeRef(this);
    }
    const span = makeSpan(dotToken.span.start, previous(this.state).span.end);
    return {
      type: 'PostfixExpr',
      primary: makePipeVarPrimary(span),
      methods: [],
      defaultValue: null,
      existenceCheck: { finalAccess, typeRef },
      span,
    } satisfies PostfixExprNode;
  },
  [TOKEN_TYPES.STRING]: function (this: Parser) {
    return this.parseString();
  },
  [TOKEN_TYPES.LBRACKET]: function (this: Parser): PipeTargetNode {
    return this.parsePipeTargetBracket();
  },
  [TOKEN_TYPES.LIST_LBRACKET]: function (this: Parser): PipeTargetNode {
    advance(this.state); // consume list[
    return withDispatchDefault(this, this.parseCollectionLiteral('list'));
  },
  [TOKEN_TYPES.DICT_LBRACKET]: function (this: Parser): PipeTargetNode {
    return this.parsePipeTargetDictLiteral();
  },
};

// ============================================================
// PIPE TARGET PARSING
// ============================================================

/**
 * Attaches a trailing `[i]` bracket index (or chain of them) to a pipe
 * target that has no `.method` chain of its own — a bare host
 * call, a parameterized type constructor, or a bare type-keyword target.
 * `list[3,1,2] -> sort[0]` yields `1`. Only same-line brackets are
 * collected; a newline before `[` starts a new statement instead, matching
 * parsePipeTargetDot's dot-chain rule.
 */
function attachPipeTargetIndex(
  this: Parser,
  primary: HostCallNode | TypeConstructorNode | TypeNameExprNode
): PipeTargetNode {
  if (!check(this.state, TOKEN_TYPES.LBRACKET)) {
    return primary;
  }
  const methods: IndexAccessNode[] = [];
  while (check(this.state, TOKEN_TYPES.LBRACKET)) {
    const openBracket = advance(this.state); // consume [
    const index = this.parsePipeChain();
    const closeBracket = expect(
      this.state,
      TOKEN_TYPES.RBRACKET,
      'Expected ] after index expression',
      ERROR_IDS.RILL_P005
    );
    methods.push({
      type: 'IndexAccess',
      index,
      span: makeSpan(openBracket.span.start, closeBracket.span.end),
    });
  }
  return {
    type: 'PostfixExpr',
    primary,
    methods,
    defaultValue: null,
    span: makeSpan(primary.span.start, (methods.at(-1) ?? primary).span.end),
  } satisfies PostfixExprNode;
}

/**
 * Moves a trailing `?? default` onto the list or dict literal inside a
 * declaration, since the default belongs to the literal that is dispatched.
 */
function withInnerDefault(
  this: Parser,
  declaration: DeclarationNode
): DeclarationNode {
  const value = declaration.value;
  if (value.type !== 'ListLiteral' && value.type !== 'Dict') return declaration;
  const withDefault = withDispatchDefault(this, value);
  if (withDefault === value) return declaration;
  return {
    ...declaration,
    value: withDefault,
    span: makeSpan(declaration.span.start, withDefault.span.end),
  };
}

/**
 * Tries the declaration hook after a written type in pipe-target position;
 * with no same-line literal the type takes its optional `[i]` index chain.
 */
function attachDeclarationOrIndex(
  this: Parser,
  typeExpr: TypeConstructorNode | TypeNameExprNode | FnTypeNode
): PipeTargetNode {
  const tail = this.parseDeclarationTail(typeExpr);
  if (tail.type === 'Declaration') return withInnerDefault.call(this, tail);
  return typeExpr.type === 'FnType'
    ? tail
    : attachPipeTargetIndex.call(this, typeExpr);
}

// Runs the same postfix dispatch loop parsePostfixExprBase uses, but over a
// caller-supplied loopState instead of one seeded by parsePrimary(). Lets a
// value produced outside the primary/postfix pipeline (a pipe-target pass
// block, or a seeded loop result wrapped by wrapLoopInPostfixExpr) still
// pick up trailing `.method`, `[index]`, `(...)`, `:type`, `.^key`, and
// `.!` the same way a primary-position expression does. Reuses
// postfixDispatchTable directly rather than re-deriving dispatch rules.
export function runPostfixDispatchLoop(
  this: Parser,
  loopState: PostfixLoopState,
  start: SourceLocation
): void {
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);

  while (
    isAnnotationAccess(this.state) ||
    isMethodCall(this.state) ||
    check(this.state, TOKEN_TYPES.LPAREN) ||
    check(this.state, TOKEN_TYPES.DOT_BANG) ||
    check(this.state, TOKEN_TYPES.LBRACKET) ||
    check(this.state, TOKEN_TYPES.COLON)
  ) {
    if (isAnnotationAccess(this.state)) {
      const dotStart = current(this.state).span.start;
      advance(this.state); // consume .
      advance(this.state); // consume ^
      skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.IDENTIFIER);
      const nameToken = expect(
        this.state,
        TOKEN_TYPES.IDENTIFIER,
        'Expected annotation key after .^'
      );
      loopState.methods.push({
        type: 'AnnotationAccess',
        key: nameToken.value,
        span: makeSpan(dotStart, nameToken.span.end),
      });
      loopState.receiverEnd = nameToken.span.end;
    } else if (isMethodCall(this.state)) {
      const receiverSpan = makeSpan(start, loopState.receiverEnd);
      const method = this.parseMethodCall(receiverSpan);
      loopState.methods.push(method);
      loopState.receiverEnd = current(this.state).span.start;
    } else {
      const tokenType = current(this.state).type;
      const tableHandler = postfixDispatchTable[tokenType];
      if (tableHandler === undefined) {
        throw new Error(
          `Internal parser error: missing postfix handler for token type '${tokenType}'`
        );
      }
      tableHandler.call(this, loopState, start);
    }
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.DOT);
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.COLON);
  }
}

// Feeds an already-parsed pipe-target primary (pass block, timeout block,
// while/do loop) through runPostfixDispatchLoop so `-> pass { } .upper` and
// `-> do { } while (cond) [0]` chain the same way a primary-position
// expression does.
function attachPipeTargetPostfixChain(
  this: Parser,
  primary: PassBlockNode | TimeoutBlockNode | WhileLoopNode | DoWhileLoopNode
): PipeTargetNode {
  const start = primary.span.start;
  const loopState: PostfixLoopState = {
    primary,
    methods: [],
    receiverEnd: primary.span.end,
  };

  runPostfixDispatchLoop.call(this, loopState, start);

  // No methods and an untouched primary: the bare target. A wrapper primary
  // (`:type`, `:?type`, `.!`) with no methods still needs a PostfixExpr so the
  // suffix is not dropped.
  if (loopState.methods.length === 0 && loopState.primary === primary) {
    return primary;
  }

  return {
    type: 'PostfixExpr',
    primary: loopState.primary,
    methods: loopState.methods,
    defaultValue: null,
    span: makeSpan(start, loopState.receiverEnd),
  } satisfies PostfixExprNode;
}

function parseUncheckedPipeTarget(this: Parser): PipeTargetNode {
  // Legacy convert operator: -> :>type (retired; emit migration error RILL-R078)
  // Must precede the COLON entry in pipeTargetDispatchTable.
  if (
    check(this.state, TOKEN_TYPES.COLON) &&
    peek(this.state, 1).type === TOKEN_TYPES.GT
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_R078,
      "Legacy ':>' conversion syntax removed; use '-> type' instead",
      current(this.state).span.start
    );
  }

  // Removed closure literals: -> |x| { body }, -> || { body }
  rejectRemovedClosureLiteral(this.state);

  // Inline fn literal or fn type value: -> fn(x) { body }
  if (isFnStart(this.state)) {
    const fnForm = this.parseFnForm();
    return fnForm.type === 'FnType'
      ? attachDeclarationOrIndex.call(this, fnForm)
      : fnForm;
  }

  // Closure call as pipe target (supports property access: $math.double())
  if (isClosureCallWithAccess(this.state)) {
    return this.parseClosureCall();
  }

  // Pipe invoke: -> $() or -> $(args)
  if (canStartPipeInvoke(this.state)) {
    return this.parsePipeInvoke();
  }

  // Bare variable as pipe target: -> $var or -> $ or -> $.field
  if (
    check(this.state, TOKEN_TYPES.DOLLAR) ||
    check(this.state, TOKEN_TYPES.PIPE_VAR)
  ) {
    const varNode = this.parseVariable();
    return { ...varNode, isPipeTarget: true };
  }

  // Table dispatch: single-token forms (ASSERT/ERROR precede isHostCall check)
  const tokenType = current(this.state).type;
  const tableHandler = pipeTargetDispatchTable[tokenType];
  if (tableHandler !== undefined) {
    return tableHandler.call(this);
  }

  // Residual fallthrough for IDENTIFIER-based forms

  // Parameterized type constructor as pipe target:
  //   -> list(...), -> dict(...), -> tuple(...), -> ordered(...), -> stream(...)
  // Mirrors the primary-expression dispatch in parsePrimary (see parseTypeConstructor).
  if (atTypeConstructor(this.state)) {
    const name = current(this.state).value;
    return attachDeclarationOrIndex.call(this, this.parseTypeConstructor(name));
  }

  // The removed `closure` type name as a pipe target
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    current(this.state).value === 'closure' &&
    this.state.tokens[this.state.pos + 1]?.type !== TOKEN_TYPES.LPAREN
  ) {
    throwRemovedClosureType(current(this.state).span.start);
  }

  // A leaf type written with empty parens before a same-line literal:
  // -> string() "a"
  const leafDeclaration = this.parseLeafCallDeclaration();
  if (leafDeclaration !== null)
    return withInnerDefault.call(this, leafDeclaration);

  // Bare type keyword as pipe target: -> string, -> number, -> bool, ...
  // Produces TypeNameExprNode (mirrors parseBareHostCall's dispatch location
  // but routes type keywords through the TypeNameExpr node rather than HostCall).
  // Type keywords are reserved; no ambiguity with host/closure names.
  const typeKeyword = current(this.state).value;
  if (
    check(this.state, TOKEN_TYPES.IDENTIFIER) &&
    isRillTypeName(typeKeyword) &&
    this.state.tokens[this.state.pos + 1]?.type !== TOKEN_TYPES.LPAREN
  ) {
    if (typeKeyword === 'union') throwBareUnion(current(this.state).span.start);
    const token = advance(this.state);
    const typeNameExpr: TypeNameExprNode = {
      type: 'TypeNameExpr',
      typeName: typeKeyword,
      span: token.span,
    };
    return attachDeclarationOrIndex.call(this, typeNameExpr);
  }

  // Function call with parens
  if (isHostCall(this.state)) {
    return attachPipeTargetIndex.call(this, this.parseHostCall());
  }

  // Bare function name: "-> greet"
  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return attachPipeTargetIndex.call(this, parseBareHostCall(this.state));
  }

  // Common constructs
  const common = this.parseCommonConstruct();
  if (common) {
    if (check(this.state, TOKEN_TYPES.COLON)) {
      const operand: PostfixExprNode = {
        type: 'PostfixExpr',
        primary: common,
        methods: [],
        defaultValue: null,
        existenceCheck: null,
        span: common.span,
      };
      return this.parsePostfixTypeOperation(operand);
    }
    // A while/do loop result is itself postfix-chainable:
    // `-> do { } while (cond) . upper`.
    if (common.type === 'WhileLoop' || common.type === 'DoWhileLoop') {
      return attachPipeTargetPostfixChain.call(this, common);
    }
    return common;
  }

  throw new ParseError(
    ERROR_IDS.RILL_P001,
    `Expected pipe target, got: ${describeToken(current(this.state))}`,
    current(this.state).span.start
  );
}

/** True when a written type is, or has a union member that is, an atom type. */
function writesAtomType(
  typeExpr: DeclarationNode['typeExpr'] | TypeRef
): boolean {
  if ('kind' in typeExpr) {
    switch (typeExpr.kind) {
      case 'literal':
        return typeExpr.value.type === 'AtomLiteral';
      case 'union':
        return typeExpr.members.some(writesAtomType);
      case 'static':
        return typeExpr.typeName === 'atom';
      default:
        return false;
    }
  }
  switch (typeExpr.type) {
    case 'TypeNameExpr':
      return typeExpr.typeName === 'atom';
    case 'TypeConstructor':
      return (
        typeExpr.constructorName === 'union' &&
        typeExpr.args.some((arg) => writesAtomType(arg.value))
      );
    default:
      return false;
  }
}

/**
 * Rejects pipe targets that ignore the piped value: a block or string that
 * never reads it, and a list or dict literal that reads `$` at its top level
 * (the literal is built from the piped value, not given it).
 */
function checkPipeTarget(target: PipeTargetNode): PipeTargetNode {
  const shape = codeBlockShape(target);
  if (shape !== undefined && target.type !== 'Block') {
    if (!readsPipeValue(shape.block, 'used')) {
      throw new ParseError(
        ERROR_IDS.RILL_P031,
        "Block pipe target does not read the piped value; reference '$' in it",
        target.span.start
      );
    }
    return target;
  }
  switch (target.type) {
    case 'Block':
    case 'StringLiteral':
      if (!readsPipeValue(target, 'used')) {
        throw new ParseError(
          ERROR_IDS.RILL_P031,
          `${target.type === 'Block' ? 'Block' : 'String'} pipe target does not read the piped value; reference '$' in it`,
          target.span.start
        );
      }
      return target;
    case 'ListLiteral':
    case 'Dict': {
      const elements =
        target.type === 'ListLiteral' ? target.elements : target.entries;
      // A held block entry binds `$` when selected, so its reads are not
      // top-level reads of the piped value.
      const readsAtTop = (element: ASTNode): boolean => {
        const value = element.type === 'DictEntry' ? element.value : element;
        return (
          codeBlockShape(value) === undefined &&
          readsPipeValue(element, 'written')
        );
      };
      if (elements.some(readsAtTop)) {
        throw new ParseError(
          ERROR_IDS.RILL_P030,
          "Literal pipe target cannot read '$' at its top level; wrap the literal in a block, as in '3 -> { list[$, $] }'",
          target.span.start
        );
      }
      return target;
    }
    case 'Declaration': {
      const value = target.value;
      if (
        value.type !== 'ListLiteral' &&
        value.type !== 'Dict' &&
        value.type !== 'StringLiteral'
      ) {
        const hint =
          value.type === 'AtomLiteral' && !writesAtomType(target.typeExpr)
            ? ". Hint: a comment needs a space after '#'"
            : '';
        throw new ParseError(
          ERROR_IDS.RILL_P001,
          `Expected pipe target, got a declared ${value.type} value${hint}`,
          value.span.start
        );
      }
      checkPipeTarget(value);
      return target;
    }
    default:
      return target;
  }
}

Parser.prototype.parsePipeTarget = function (this: Parser): PipeTargetNode {
  return checkPipeTarget(parseUncheckedPipeTarget.call(this));
};
