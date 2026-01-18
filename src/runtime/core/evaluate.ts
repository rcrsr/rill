/**
 * Expression Evaluation
 *
 * Internal module for AST evaluation. Not part of public API.
 * All evaluation functions are internal implementation details.
 *
 * @internal
 */

import type {
  AnnotatedStatementNode,
  AnnotationArg,
  ArithHead,
  ASTNode,
  BinaryExprNode,
  BlockNode,
  BracketAccess,
  CaptureNode,
  IteratorBody,
  ConditionalNode,
  DestructureNode,
  DictNode,
  DoWhileLoopNode,
  EachExprNode,
  ExpressionNode,
  FieldAccess,
  FilterExprNode,
  FoldExprNode,
  ForLoopNode,
  HostCallNode,
  ClosureNode,
  GroupedExprNode,
  InvokeNode,
  PipeInvokeNode,
  MapExprNode,
  MethodCallNode,
  PipeChainNode,
  PostfixExprNode,
  PropertyAccess,
  RillTypeName,
  ClosureChainNode,
  BodyNode,
  SliceNode,
  SourceLocation,
  SpreadNode,
  StatementNode,
  StringLiteralNode,
  TupleNode,
  TypeAssertionNode,
  TypeCheckNode,
  UnaryExprNode,
  ClosureCallNode,
  VariableNode,
} from '../../types.js';
import {
  AbortError,
  AutoExceptionError,
  RILL_ERROR_CODES,
  RuntimeError,
  TimeoutError,
} from '../../types.js';
import type {
  ApplicationCallable,
  CallableParam,
  RillCallable,
  RuntimeCallable,
  ScriptCallable,
} from './callable.js';
import { isCallable, isDict, isScriptCallable } from './callable.js';
import { createChildContext, getVariable, hasVariable } from './context.js';
import { BreakSignal, ReturnSignal } from './signals.js';
import type { RuntimeContext } from './types.js';
import {
  checkType,
  createTupleFromDict,
  createTupleFromList,
  deepEquals,
  formatValue,
  inferType,
  isRillIterator,
  isTuple,
  isReservedMethod,
  isTruthy,
  type RillTuple,
  type RillValue,
} from './values.js';

// ============================================================
// CONSTANTS
// ============================================================

/** Default maximum iterations when no limit annotation is set */
const DEFAULT_MAX_ITERATIONS = 10000;

// ============================================================
// EXPORTED HELPERS (used by execute.ts)
// ============================================================

/** Helper to get location from an AST node */
function getNodeLocation(node?: ASTNode): SourceLocation | undefined {
  return node?.span.start;
}

/**
 * Check if execution has been aborted via AbortSignal.
 * Throws AbortError if signal is aborted.
 */
export function checkAborted(ctx: RuntimeContext, node?: ASTNode): void {
  if (ctx.signal?.aborted) {
    throw new AbortError(getNodeLocation(node));
  }
}

/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws AutoExceptionError on match.
 */
export function checkAutoExceptions(
  value: RillValue,
  ctx: RuntimeContext,
  node?: ASTNode
): void {
  if (typeof value !== 'string' || ctx.autoExceptions.length === 0) {
    return;
  }

  for (const pattern of ctx.autoExceptions) {
    if (pattern.test(value)) {
      throw new AutoExceptionError(
        pattern.source,
        value,
        getNodeLocation(node)
      );
    }
  }
}

/**
 * Handle statement capture: set variable and fire observability event.
 * Returns capture info if a capture occurred.
 */
export function handleCapture(
  capture: CaptureNode | null,
  value: RillValue,
  ctx: RuntimeContext
): { name: string; value: RillValue } | undefined {
  if (!capture) return undefined;

  setVariable(ctx, capture.name, value, capture.typeName, capture.span.start);
  const captureInfo = { name: capture.name, value };
  ctx.observability.onCapture?.(captureInfo);
  return captureInfo;
}

// ============================================================
// TYPE ASSERTION HELPERS
// ============================================================

/**
 * Assert that a value is of the expected type.
 * Returns the value unchanged if assertion passes, throws on mismatch.
 * Exported for use by type assertion evaluation.
 */
export function assertType(
  value: RillValue,
  expected: RillTypeName,
  location?: SourceLocation
): RillValue {
  const actual = inferType(value);
  if (actual !== expected) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Type assertion failed: expected ${expected}, got ${actual}`,
      location,
      { expectedType: expected, actualType: actual }
    );
  }
  return value;
}

// ============================================================
// VARIABLE MANAGEMENT
// ============================================================

/**
 * Set a variable with type checking.
 * - First assignment locks the type (inferred or explicit)
 * - Subsequent assignments must match the locked type
 * - Explicit type annotation is validated against value type
 * - Cannot shadow outer scope variables (produces error)
 */
function setVariable(
  ctx: RuntimeContext,
  name: string,
  value: RillValue,
  explicitType: RillTypeName | null,
  location?: SourceLocation
): void {
  const valueType = inferType(value);

  // Check explicit type annotation matches value
  if (explicitType !== null && explicitType !== valueType) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Type mismatch: cannot assign ${valueType} to $${name}:${explicitType}`,
      location,
      { variableName: name, expectedType: explicitType, actualType: valueType }
    );
  }

  // Check if this is a new variable that would shadow an outer scope variable
  // (error: cannot shadow outer scope variables in child scopes)
  if (!ctx.variables.has(name) && ctx.parent && hasVariable(ctx.parent, name)) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Cannot shadow outer variable $${name} in child scope`,
      location,
      { variableName: name }
    );
  }

  // Check if variable already has a locked type in current scope
  const lockedType = ctx.variableTypes.get(name);
  if (lockedType !== undefined && lockedType !== valueType) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Type mismatch: cannot assign ${valueType} to $${name} (locked as ${lockedType})`,
      location,
      { variableName: name, expectedType: lockedType, actualType: valueType }
    );
  }

  // Set the variable and lock its type in current scope
  ctx.variables.set(name, value);
  if (!ctx.variableTypes.has(name)) {
    ctx.variableTypes.set(name, explicitType ?? valueType);
  }
}

// ============================================================
// TIMEOUT WRAPPER
// ============================================================

/**
 * Wrap a promise with a timeout. Returns original promise if no timeout configured.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  functionName: string,
  node?: ASTNode
): Promise<T> {
  if (timeoutMs === undefined) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new TimeoutError(functionName, timeoutMs, getNodeLocation(node))
        );
      }, timeoutMs);
    }),
  ]);
}

// ============================================================
// EXPRESSION EVALUATION
// ============================================================

/**
 * Evaluate argument expressions while preserving the current pipeValue.
 */
async function evaluateArgs(
  argExprs: ExpressionNode[],
  ctx: RuntimeContext
): Promise<RillValue[]> {
  const savedPipeValue = ctx.pipeValue;
  const args: RillValue[] = [];
  for (const arg of argExprs) {
    args.push(await evaluateExpression(arg, ctx));
  }
  ctx.pipeValue = savedPipeValue;
  return args;
}

export async function evaluateExpression(
  expr: ExpressionNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  return evaluatePipeChain(expr, ctx);
}

async function evaluatePipeChain(
  chain: PipeChainNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Evaluate head (can be PostfixExpr, BinaryExpr, or UnaryExpr)
  let value: RillValue;
  switch (chain.head.type) {
    case 'BinaryExpr':
      value = await evaluateBinaryExpr(chain.head, ctx);
      break;
    case 'UnaryExpr':
      value = await evaluateUnaryExpr(chain.head, ctx);
      break;
    case 'PostfixExpr':
      value = await evaluatePostfixExpr(chain.head, ctx);
      break;
  }
  ctx.pipeValue = value;

  for (const target of chain.pipes) {
    value = await evaluatePipeTarget(target, value, ctx);
    ctx.pipeValue = value;
  }

  // Handle chain terminator (capture, break, return)
  if (chain.terminator) {
    if (chain.terminator.type === 'Break') {
      throw new BreakSignal(value);
    }
    if (chain.terminator.type === 'Return') {
      throw new ReturnSignal(value);
    }
    // Capture
    handleCapture(chain.terminator, value, ctx);
  }

  return value;
}

async function evaluatePostfixExpr(
  expr: PostfixExprNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  let value = await evaluatePrimary(expr.primary, ctx);

  for (const method of expr.methods) {
    value = await evaluateMethod(method, value, ctx);
  }

  return value;
}

async function evaluatePrimary(
  primary: PostfixExprNode['primary'],
  ctx: RuntimeContext
): Promise<RillValue> {
  switch (primary.type) {
    case 'StringLiteral':
      return evaluateString(primary, ctx);

    case 'NumberLiteral':
      return primary.value;

    case 'BoolLiteral':
      return primary.value;

    case 'Tuple':
      return evaluateTuple(primary, ctx);

    case 'Dict':
      return evaluateDict(primary, ctx);

    case 'Closure':
      return await createClosure(primary, ctx);

    case 'Variable':
      return evaluateVariableAsync(primary, ctx);

    case 'HostCall':
      return evaluateHostCall(primary, ctx);

    case 'ClosureCall':
      return evaluateClosureCall(primary, ctx);

    case 'MethodCall':
      return evaluateMethod(primary, ctx.pipeValue, ctx);

    case 'Conditional':
      return evaluateConditional(primary, ctx);

    case 'ForLoop':
      return evaluateForLoop(primary, ctx);

    case 'DoWhileLoop':
      return evaluateDoWhileLoop(primary, ctx);

    case 'Block':
      return evaluateBlockExpression(primary, ctx);

    case 'GroupedExpr':
      return evaluateGroupedExpr(primary, ctx);

    case 'Spread':
      return evaluateSpread(primary, ctx);

    case 'TypeAssertion':
      return evaluateTypeAssertionPrimary(primary, ctx);

    case 'TypeCheck':
      return evaluateTypeCheckPrimary(primary, ctx);

    default:
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Unknown primary type: ${(primary as ASTNode).type}`,
        getNodeLocation(primary as ASTNode)
      );
  }
}

/**
 * Evaluate postfix type assertion: expr:type
 * The operand is always present (not null) for postfix form.
 */
async function evaluateTypeAssertionPrimary(
  node: TypeAssertionNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  if (!node.operand) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      'Postfix type assertion requires operand',
      node.span.start
    );
  }
  const value = await evaluatePostfixExpr(node.operand, ctx);
  return evaluateTypeAssertion(node, value, ctx);
}

/**
 * Evaluate postfix type check: expr:?type
 * The operand is always present (not null) for postfix form.
 */
async function evaluateTypeCheckPrimary(
  node: TypeCheckNode,
  ctx: RuntimeContext
): Promise<boolean> {
  if (!node.operand) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      'Postfix type check requires operand',
      node.span.start
    );
  }
  const value = await evaluatePostfixExpr(node.operand, ctx);
  return evaluateTypeCheck(node, value, ctx);
}

async function evaluatePipeTarget(
  target: PipeChainNode['pipes'][number],
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  ctx.pipeValue = input;

  switch (target.type) {
    case 'Capture':
      return evaluateCapture(target, input, ctx);

    case 'HostCall':
      return evaluateHostCall(target, ctx);

    case 'ClosureCall':
      return evaluateClosureCallWithPipe(target, input, ctx);

    case 'PipeInvoke':
      return evaluatePipeInvoke(target, input, ctx);

    case 'MethodCall':
      return evaluateMethod(target, input, ctx);

    case 'Conditional':
      return evaluateConditional(target, ctx);

    case 'ForLoop':
      return evaluateForLoop(target, ctx);

    case 'DoWhileLoop':
      return evaluateDoWhileLoop(target, ctx);

    case 'Block':
      return evaluateBlockExpression(target, ctx);

    case 'StringLiteral':
      return evaluateString(target, ctx);

    case 'GroupedExpr':
      return evaluateGroupedExpr(target, ctx);

    case 'ClosureChain':
      return evaluateClosureChain(target, input, ctx);

    case 'Destructure':
      return evaluateDestructure(target, input, ctx);

    case 'Slice':
      return evaluateSlice(target, input, ctx);

    case 'Spread':
      return evaluateSpread(target, ctx);

    case 'TypeAssertion':
      return evaluateTypeAssertion(target, input, ctx);

    case 'TypeCheck':
      return evaluateTypeCheck(target, input, ctx);

    case 'EachExpr':
      return evaluateEach(target, input, ctx);

    case 'MapExpr':
      return evaluateMap(target, input, ctx);

    case 'FoldExpr':
      return evaluateFold(target, input, ctx);

    case 'FilterExpr':
      return evaluateFilter(target, input, ctx);

    default:
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Unknown pipe target type: ${(target as ASTNode).type}`,
        getNodeLocation(target as ASTNode)
      );
  }
}

// ============================================================
// STATEMENT EXECUTION
// ============================================================

export async function executeStatement(
  stmt: StatementNode | AnnotatedStatementNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Handle annotated statements
  if (stmt.type === 'AnnotatedStatement') {
    return executeAnnotatedStatement(stmt, ctx);
  }

  const value = await evaluateExpression(stmt.expression, ctx);
  ctx.pipeValue = value;
  checkAutoExceptions(value, ctx, stmt);

  // Terminator handling is now inside PipeChainNode evaluation
  // (evaluatePipeChain handles capture/break/return terminators)

  return value;
}

/**
 * Execute an annotated statement.
 * Evaluates annotations, pushes them to the stack, executes the inner statement,
 * and pops the annotations.
 */
async function executeAnnotatedStatement(
  stmt: AnnotatedStatementNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Evaluate annotation arguments to build annotation dict
  const newAnnotations = await evaluateAnnotations(stmt.annotations, ctx);

  // Merge with inherited annotations (inner overrides outer)
  const inherited = ctx.annotationStack.at(-1) ?? {};
  const merged = { ...inherited, ...newAnnotations };

  // Push merged annotations, execute inner statement, pop
  ctx.annotationStack.push(merged);
  try {
    return await executeStatement(stmt.statement, ctx);
  } finally {
    ctx.annotationStack.pop();
  }
}

/**
 * Evaluate annotation arguments to a dict of key-value pairs.
 */
async function evaluateAnnotations(
  annotations: AnnotationArg[],
  ctx: RuntimeContext
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};

  for (const arg of annotations) {
    if (arg.type === 'NamedArg') {
      result[arg.name] = await evaluateExpression(arg.value, ctx);
    } else {
      // SpreadArg: spread tuple/dict keys as annotations
      const spreadValue = await evaluateExpression(arg.expression, ctx);
      if (
        typeof spreadValue === 'object' &&
        spreadValue !== null &&
        !Array.isArray(spreadValue) &&
        !isCallable(spreadValue)
      ) {
        // Dict: spread all key-value pairs
        Object.assign(result, spreadValue);
      } else if (Array.isArray(spreadValue)) {
        // Tuple/list: not valid for annotations (need named keys)
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'Annotation spread requires dict with named keys, got list',
          arg.span.start
        );
      } else {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Annotation spread requires dict, got ${typeof spreadValue}`,
          arg.span.start
        );
      }
    }
  }

  return result;
}

/**
 * Get the current value of an annotation from the annotation stack.
 */
export function getAnnotation(
  ctx: RuntimeContext,
  key: string
): RillValue | undefined {
  return ctx.annotationStack.at(-1)?.[key];
}

/**
 * Get the iteration limit for loops from the `limit` annotation.
 * Returns the default if not set or if the value is not a positive number.
 */
function getIterationLimit(ctx: RuntimeContext): number {
  const limit = getAnnotation(ctx, 'limit');
  if (typeof limit === 'number' && limit > 0) {
    return Math.floor(limit);
  }
  return DEFAULT_MAX_ITERATIONS;
}

async function evaluateClosureChain(
  node: ClosureChainNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  const target = await evaluateExpression(node.target, ctx);

  const closures = Array.isArray(target) ? target : [target];
  let accumulated = input;

  for (const closure of closures) {
    accumulated = await invokeAsCallableOrFunction(
      closure,
      [accumulated],
      ctx,
      node.span.start
    );
  }

  return accumulated;
}

// ============================================================
// COLLECTION OPERATORS (each, map, fold)
// ============================================================

/**
 * Get iterable elements from input value.
 * Returns array of elements to iterate over.
 * For dicts, returns array of { key, value } objects.
 */
/**
 * Check if a value is a rill iterator (dict with value, done, next fields).
 * Iterators follow the protocol: { value: any, done: bool, next: closure }
 */

/**
 * Expand a rill iterator into an array of elements.
 * Respects iteration limits to prevent infinite loops.
 */
async function expandIterator(
  iterator: RillValue,
  ctx: RuntimeContext,
  node: { span: { start: SourceLocation } },
  limit: number = 10000
): Promise<RillValue[]> {
  const elements: RillValue[] = [];
  let current = iterator as Record<string, RillValue>;
  let count = 0;

  while (!current['done'] && count < limit) {
    checkAborted(ctx, undefined);
    const val = current['value'];
    if (val !== undefined) {
      elements.push(val);
    }
    count++;

    // Invoke next() to get the next iterator
    const nextClosure = current['next'];
    if (nextClosure === undefined || !isCallable(nextClosure)) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        'Iterator .next must be a closure',
        node.span.start
      );
    }
    const nextIterator = await invokeCallable(
      nextClosure,
      [],
      ctx,
      node.span.start
    );
    if (!isRillIterator(nextIterator)) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        'Iterator .next must return an iterator',
        node.span.start
      );
    }
    current = nextIterator as Record<string, RillValue>;
  }

  if (count >= limit && !current['done']) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Iterator exceeded ${limit} elements (use ^(limit: N) to increase)`,
      node.span.start
    );
  }

  return elements;
}

async function getIterableElements(
  input: RillValue,
  ctx: RuntimeContext,
  node: { span: { start: SourceLocation } }
): Promise<RillValue[]> {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === 'string') {
    return [...input];
  }
  // Check for iterator protocol BEFORE generic dict handling
  if (isRillIterator(input)) {
    return expandIterator(input, ctx, node);
  }
  if (isDict(input)) {
    // Dict iteration: sorted keys, each element is { key, value }
    const keys = Object.keys(input).sort();
    return keys.map((key) => ({
      key,
      value: (input as Record<string, RillValue>)[key]!,
    }));
  }
  throw new RuntimeError(
    RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    `Collection operators require list, string, dict, or iterator, got ${inferType(input)}`,
    node.span.start
  );
}

/**
 * Evaluate collection body for a single element.
 * Handles all body forms: closure, block, grouped, variable, postfix, spread.
 */
async function evaluateIteratorBody(
  body: IteratorBody,
  element: RillValue,
  accumulator: RillValue | null,
  ctx: RuntimeContext
): Promise<RillValue> {
  switch (body.type) {
    case 'Closure': {
      // Inline closure: invoke with element (and accumulator if present in params)
      const closure = await createClosure(body, ctx);
      const args: RillValue[] = [element];
      // Accumulator is passed as second arg if closure has 2+ params
      // and the last param has a default (accumulator pattern)
      if (accumulator !== null && closure.params.length >= 2) {
        args.push(accumulator);
      }
      return invokeCallable(closure, args, ctx, body.span.start);
    }

    case 'Block': {
      // Block: evaluate with $ = element, $@ = accumulator
      const blockCtx = createChildContext(ctx);
      blockCtx.pipeValue = element;
      if (accumulator !== null) {
        blockCtx.variables.set('@', accumulator);
      }
      return evaluateBlockExpression(body, blockCtx);
    }

    case 'GroupedExpr': {
      // Grouped: evaluate with $ = element
      const groupedCtx = createChildContext(ctx);
      groupedCtx.pipeValue = element;
      return evaluateGroupedExpr(body, groupedCtx);
    }

    case 'Variable': {
      // Variable closure: get closure and invoke with element
      const varValue = getVariable(ctx, body.name ?? '');
      if (body.isPipeVar) {
        // $ by itself = identity, return element unchanged
        return element;
      }
      if (!varValue) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
          `Undefined variable: $${body.name}`,
          body.span.start
        );
      }
      if (!isCallable(varValue)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Collection body variable must be callable, got ${inferType(varValue)}`,
          body.span.start
        );
      }
      const args: RillValue[] = [element];
      if (
        accumulator !== null &&
        varValue.kind === 'script' &&
        varValue.params.length >= 2
      ) {
        args.push(accumulator);
      }
      return invokeCallable(varValue, args, ctx, body.span.start);
    }

    case 'PostfixExpr': {
      // PostfixExpr: evaluate with $ = element
      const postfixCtx = createChildContext(ctx);
      postfixCtx.pipeValue = element;
      return evaluatePostfixExpr(body, postfixCtx);
    }

    case 'Spread': {
      // Spread: convert element to tuple
      const spreadCtx = createChildContext(ctx);
      spreadCtx.pipeValue = element;
      return evaluateSpread(body, spreadCtx);
    }

    default:
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Unknown collection body type: ${(body as ASTNode).type}`,
        (body as ASTNode).span.start
      );
  }
}

/**
 * Evaluate each expression: sequential iteration returning list of all results.
 *
 * With accumulator: returns list of running values (scan/prefix-sum pattern)
 * Without accumulator: returns list of body results
 *
 * Supports break for early termination.
 */
async function evaluateEach(
  node: EachExprNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue[]> {
  const elements = await getIterableElements(input, ctx, node);

  // Empty collection: return []
  if (elements.length === 0) {
    return [];
  }

  // Get initial accumulator value if present
  let accumulator: RillValue | null = null;
  if (node.accumulator) {
    accumulator = await evaluateExpression(node.accumulator, ctx);
  } else if (node.body.type === 'Closure' && node.body.params.length >= 2) {
    // Inline closure with accumulator: |x, acc = init| body
    const lastParam = node.body.params[node.body.params.length - 1];
    if (lastParam?.defaultValue) {
      accumulator = await evaluatePrimary(lastParam.defaultValue, ctx);
    }
  }

  const results: RillValue[] = [];

  try {
    for (const element of elements) {
      checkAborted(ctx, node);
      const result = await evaluateIteratorBody(
        node.body,
        element,
        accumulator,
        ctx
      );
      results.push(result);
      // Update accumulator for next iteration (scan pattern)
      if (accumulator !== null) {
        accumulator = result;
      }
    }
  } catch (e) {
    if (e instanceof BreakSignal) {
      // Break: return results collected so far
      return results;
    }
    throw e;
  }

  return results;
}

/**
 * Evaluate map expression: parallel iteration returning list of all results.
 *
 * Uses Promise.all for concurrent execution.
 * Concurrency limit via ^(limit: N) annotation.
 */
async function evaluateMap(
  node: MapExprNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue[]> {
  const elements = await getIterableElements(input, ctx, node);

  // Empty collection: return []
  if (elements.length === 0) {
    return [];
  }

  // Check for concurrency limit annotation
  const limitAnnotation = getAnnotation(ctx, 'limit');
  const concurrencyLimit =
    typeof limitAnnotation === 'number' && limitAnnotation > 0
      ? Math.floor(limitAnnotation)
      : Infinity;

  if (concurrencyLimit === Infinity) {
    // No limit: all in parallel
    const promises = elements.map((element) =>
      evaluateIteratorBody(node.body, element, null, ctx)
    );
    return Promise.all(promises);
  }

  // With limit: process in batches
  const results: RillValue[] = [];
  for (let i = 0; i < elements.length; i += concurrencyLimit) {
    checkAborted(ctx, node);
    const batch = elements.slice(i, i + concurrencyLimit);
    const batchPromises = batch.map((element) =>
      evaluateIteratorBody(node.body, element, null, ctx)
    );
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Evaluate fold expression: sequential reduction returning final result only.
 *
 * Accumulator is required.
 * Empty collection: returns initial accumulator value.
 */
async function evaluateFold(
  node: FoldExprNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  const elements = await getIterableElements(input, ctx, node);

  // Get initial accumulator value
  let accumulator: RillValue;
  if (node.accumulator) {
    accumulator = await evaluateExpression(node.accumulator, ctx);
  } else if (node.body.type === 'Closure' && node.body.params.length >= 2) {
    // Inline closure with accumulator: |x, acc = init| body
    const lastParam = node.body.params[node.body.params.length - 1];
    if (lastParam?.defaultValue) {
      accumulator = await evaluatePrimary(lastParam.defaultValue, ctx);
    } else {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        'Fold requires accumulator: use |x, acc = init| or fold(init) { }',
        node.span.start
      );
    }
  } else if (node.body.type === 'Variable' && !node.body.isPipeVar) {
    // Variable closure: the closure itself must have an accumulator default
    const varValue = getVariable(ctx, node.body.name ?? '');
    if (!varValue || !isCallable(varValue) || varValue.kind !== 'script') {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        'Fold variable must be a script closure with accumulator parameter',
        node.span.start
      );
    }
    const lastParam = varValue.params[varValue.params.length - 1];
    if (lastParam && lastParam.defaultValue !== null) {
      accumulator = lastParam.defaultValue;
    } else {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        'Fold closure must have accumulator parameter with default value',
        node.span.start
      );
    }
  } else {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      'Fold requires accumulator: use |x, acc = init| or fold(init) { }',
      node.span.start
    );
  }

  // Empty collection: return initial accumulator
  if (elements.length === 0) {
    return accumulator;
  }

  for (const element of elements) {
    checkAborted(ctx, node);
    accumulator = await evaluateIteratorBody(
      node.body,
      element,
      accumulator,
      ctx
    );
  }

  return accumulator;
}

/**
 * Evaluate filter expression: parallel filtering, returns elements where predicate is truthy.
 *
 * Executes predicate for all elements concurrently.
 * Preserves original element order.
 * Empty collection: returns [].
 */
async function evaluateFilter(
  node: FilterExprNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue[]> {
  const elements = await getIterableElements(input, ctx, node);

  // Empty collection: return []
  if (elements.length === 0) {
    return [];
  }

  // Evaluate predicate for all elements in parallel
  const predicatePromises = elements.map(async (element) => {
    checkAborted(ctx, node);
    const result = await evaluateIteratorBody(node.body, element, null, ctx);
    return { element, keep: isTruthy(result) };
  });

  const results = await Promise.all(predicatePromises);

  // Filter elements where predicate was truthy
  return results.filter((r) => r.keep).map((r) => r.element);
}

async function invokeAsCallableOrFunction(
  callableOrName: RillValue,
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation
): Promise<RillValue> {
  if (isCallable(callableOrName)) {
    return invokeCallable(callableOrName, args, ctx, location);
  }

  if (typeof callableOrName === 'string') {
    const fn = ctx.functions.get(callableOrName);
    if (fn) {
      return fn(args, ctx, location);
    }
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_UNDEFINED_FUNCTION,
      `Unknown function: ${callableOrName}`,
      location,
      { functionName: callableOrName }
    );
  }

  throw new RuntimeError(
    RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    `Expected callable or function name, got ${typeof callableOrName}`,
    location
  );
}

function evaluateCapture(
  node: CaptureNode,
  input: RillValue,
  ctx: RuntimeContext
): RillValue {
  setVariable(ctx, node.name, input, node.typeName, node.span.start);
  ctx.observability.onCapture?.({ name: node.name, value: input });
  return input;
}

// ============================================================
// EXTRACTION OPERATORS
// ============================================================

function evaluateDestructure(
  node: DestructureNode,
  input: RillValue,
  ctx: RuntimeContext
): RillValue {
  const isList = Array.isArray(input);
  const isDictInput = isDict(input);

  const firstNonSkip = node.elements.find((e) => e.kind !== 'skip');
  const isKeyPattern = firstNonSkip?.kind === 'keyValue';

  if (isKeyPattern) {
    if (!isDictInput) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Key destructure requires dict, got ${isList ? 'list' : typeof input}`,
        node.span.start
      );
    }

    for (const elem of node.elements) {
      if (elem.kind === 'skip') continue;
      if (elem.kind === 'nested') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'Nested destructure not supported in dict patterns',
          elem.span.start
        );
      }
      if (elem.kind !== 'keyValue' || elem.key === null || elem.name === null) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'Dict destructure requires key: $var patterns',
          elem.span.start
        );
      }

      const dictInput = input as Record<string, RillValue>;
      if (!(elem.key in dictInput)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Key '${elem.key}' not found in dict`,
          elem.span.start,
          { key: elem.key, availableKeys: Object.keys(dictInput) }
        );
      }

      const dictValue = dictInput[elem.key];
      if (dictValue === undefined) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Key '${elem.key}' has undefined value`,
          elem.span.start
        );
      }

      setVariable(ctx, elem.name, dictValue, elem.typeName, elem.span.start);
    }
  } else {
    if (!isList) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Positional destructure requires list, got ${isDictInput ? 'dict' : typeof input}`,
        node.span.start
      );
    }

    const listInput = input as RillValue[];
    if (node.elements.length !== listInput.length) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Destructure pattern has ${node.elements.length} elements, list has ${listInput.length}`,
        node.span.start
      );
    }

    for (let i = 0; i < node.elements.length; i++) {
      const elem = node.elements[i];
      const value = listInput[i];

      if (elem === undefined || value === undefined) {
        continue;
      }

      if (elem.kind === 'skip') continue;

      if (elem.kind === 'nested' && elem.nested) {
        evaluateDestructure(elem.nested, value, ctx);
        continue;
      }

      if (elem.name === null) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'Invalid destructure element',
          elem.span.start
        );
      }

      setVariable(ctx, elem.name, value, elem.typeName, elem.span.start);
    }
  }

  return input;
}

async function evaluateSlice(
  node: SliceNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  const isList = Array.isArray(input);
  const isString = typeof input === 'string';

  if (!isList && !isString) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Slice requires list or string, got ${isDict(input) ? 'dict' : typeof input}`,
      node.span.start
    );
  }

  const startBound = node.start
    ? await evaluateSliceBound(node.start, ctx)
    : null;
  const stopBound = node.stop ? await evaluateSliceBound(node.stop, ctx) : null;
  const stepBound = node.step ? await evaluateSliceBound(node.step, ctx) : null;

  if (isList) {
    return applySlice(input, input.length, startBound, stopBound, stepBound);
  }
  return applySlice(input, input.length, startBound, stopBound, stepBound);
}

async function evaluateSliceBound(
  bound: SliceNode['start'],
  ctx: RuntimeContext
): Promise<number> {
  if (bound === null) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      'Slice bound is null',
      undefined
    );
  }

  switch (bound.type) {
    case 'NumberLiteral':
      return bound.value;

    case 'Variable': {
      const value = evaluateVariable(bound, ctx);
      if (typeof value !== 'number') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Slice bound must be number, got ${typeof value}`,
          bound.span.start
        );
      }
      return value;
    }

    case 'GroupedExpr': {
      const value = await evaluateGroupedExpr(bound, ctx);
      if (typeof value !== 'number') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Slice bound must be number, got ${typeof value}`,
          bound.span.start
        );
      }
      return value;
    }
  }
}

function applySlice<T extends RillValue[] | string>(
  input: T,
  len: number,
  start: number | null,
  stop: number | null,
  step: number | null
): T {
  const actualStep = step ?? 1;

  if (actualStep === 0) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      'Slice step cannot be zero',
      undefined
    );
  }

  const normalizeIndex = (
    idx: number | null,
    defaultVal: number,
    forStep: number
  ): number => {
    if (idx === null) return defaultVal;
    let normalized = idx < 0 ? len + idx : idx;
    if (forStep > 0) {
      normalized = Math.max(0, Math.min(len, normalized));
    } else {
      normalized = Math.max(-1, Math.min(len - 1, normalized));
    }
    return normalized;
  };

  const actualStart = normalizeIndex(
    start,
    actualStep > 0 ? 0 : len - 1,
    actualStep
  );
  const actualStop = normalizeIndex(
    stop,
    actualStep > 0 ? len : -1,
    actualStep
  );

  const indices: number[] = [];
  if (actualStep > 0) {
    for (let i = actualStart; i < actualStop; i += actualStep) {
      indices.push(i);
    }
  } else {
    for (let i = actualStart; i > actualStop; i += actualStep) {
      indices.push(i);
    }
  }

  if (Array.isArray(input)) {
    return indices.map((i) => input[i]) as T;
  } else {
    return indices.map((i) => input[i]).join('') as T;
  }
}

async function evaluateSpread(
  node: SpreadNode,
  ctx: RuntimeContext
): Promise<RillTuple> {
  let value: RillValue;
  if (node.operand === null) {
    value = ctx.pipeValue;
  } else {
    value = await evaluateExpression(node.operand, ctx);
  }

  if (Array.isArray(value)) {
    return createTupleFromList(value);
  }

  if (isDict(value)) {
    return createTupleFromDict(value);
  }

  throw new RuntimeError(
    RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
    `Spread requires list or dict, got ${inferType(value)}`,
    node.span.start
  );
}

// ============================================================
// TYPE OPERATIONS
// ============================================================

/**
 * Evaluate type assertion: expr:type or :type (shorthand for $:type)
 * Returns value unchanged if type matches, throws on mismatch.
 */
async function evaluateTypeAssertion(
  node: TypeAssertionNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  // If operand is null, use the input (pipe value)
  // Otherwise, evaluate the operand
  const value = node.operand
    ? await evaluatePostfixExpr(node.operand, ctx)
    : input;

  return assertType(value, node.typeName, node.span.start);
}

/**
 * Evaluate type check: expr:?type or :?type (shorthand for $:?type)
 * Returns true if type matches, false otherwise.
 */
async function evaluateTypeCheck(
  node: TypeCheckNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<boolean> {
  // If operand is null, use the input (pipe value)
  // Otherwise, evaluate the operand
  const value = node.operand
    ? await evaluatePostfixExpr(node.operand, ctx)
    : input;

  return checkType(value, node.typeName);
}

// ============================================================
// LITERAL EVALUATION
// ============================================================

async function evaluateString(
  node: StringLiteralNode,
  ctx: RuntimeContext
): Promise<string> {
  let result = '';
  // Save pipeValue since interpolation expressions can modify it
  const savedPipeValue = ctx.pipeValue;
  for (const part of node.parts) {
    if (typeof part === 'string') {
      result += part;
    } else {
      // InterpolationNode: evaluate the expression
      // Restore pipeValue before each interpolation so they all see the same value
      ctx.pipeValue = savedPipeValue;
      const value = await evaluateExpression(part.expression, ctx);
      result += formatValue(value);
    }
  }
  // Restore pipeValue after string evaluation
  ctx.pipeValue = savedPipeValue;
  return result;
}

async function evaluateTuple(
  node: TupleNode,
  ctx: RuntimeContext
): Promise<RillValue[]> {
  const elements: RillValue[] = [];
  for (const elem of node.elements) {
    elements.push(await evaluateExpression(elem, ctx));
  }
  return elements;
}

function isClosureExpr(expr: PipeChainNode): boolean {
  if (expr.pipes.length > 0) return false;
  if (expr.head.type !== 'PostfixExpr') return false;
  if (expr.head.methods.length > 0) return false;
  return expr.head.primary.type === 'Closure';
}

async function evaluateDict(
  node: DictNode,
  ctx: RuntimeContext
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};
  for (const entry of node.entries) {
    if (isReservedMethod(entry.key)) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Cannot use reserved method name '${entry.key}' as dict key`,
        entry.span.start,
        { key: entry.key, reservedMethods: ['keys', 'values', 'entries'] }
      );
    }

    if (isClosureExpr(entry.value)) {
      // Safe cast: isClosureExpr ensures head is PostfixExpr with Closure primary
      const head = entry.value.head as PostfixExprNode;
      const fnLit = head.primary as ClosureNode;
      const closure = await createClosure(fnLit, ctx);
      result[entry.key] = closure;
    } else {
      result[entry.key] = await evaluateExpression(entry.value, ctx);
    }
  }

  for (const key of Object.keys(result)) {
    const value = result[key];
    if (value !== undefined && isCallable(value)) {
      result[key] = {
        ...value,
        boundDict: result,
      };
    }
  }

  return result;
}

async function createClosure(
  node: ClosureNode,
  ctx: RuntimeContext
): Promise<ScriptCallable> {
  // Store reference to the defining scope for late-bound variable resolution
  const definingScope = ctx;

  const params: CallableParam[] = [];
  for (const param of node.params) {
    let defaultValue: RillValue | null = null;
    if (param.defaultValue) {
      defaultValue = await evaluatePrimary(param.defaultValue, ctx);
    }
    params.push({
      name: param.name,
      typeName: param.typeName,
      defaultValue,
    });
  }

  const isProperty = params.length === 0;

  return {
    __type: 'callable',
    kind: 'script',
    params,
    body: node.body,
    definingScope,
    isProperty,
  };
}

// ============================================================
// VARIABLE EVALUATION
// ============================================================

function getBaseVariableValue(
  node: VariableNode,
  ctx: RuntimeContext
): RillValue {
  if (node.isPipeVar) return ctx.pipeValue;
  if (node.name) return getVariable(ctx, node.name) ?? null;
  return null;
}

function resolveFieldAccess(
  access: FieldAccess,
  value: RillValue,
  ctx: RuntimeContext
): string | number {
  switch (access.kind) {
    case 'literal':
      return access.field;
    case 'variable': {
      const varValue = getVariable(ctx, access.variableName);
      if (typeof varValue === 'string') return varValue;
      if (typeof varValue === 'number') return varValue;
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Variable field access requires string or number, got ${typeof varValue}`,
        undefined,
        {}
      );
    }
    case 'alternatives': {
      // Try each alternative, return first that exists
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const dict = value as Record<string, RillValue>;
        for (const alt of access.alternatives) {
          if (alt in dict) return alt;
        }
      }
      return access.alternatives[0] ?? ''; // fallback to first
    }
    case 'computed':
    case 'block':
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Computed/block field access requires async evaluation`,
        undefined,
        {}
      );
  }
}

function evaluateVariable(node: VariableNode, ctx: RuntimeContext): RillValue {
  // Note: sync version doesn't support existence checks with computed/block access
  // Those require async. Simple existence checks are handled here.
  if (node.existenceCheck) {
    return evaluateExistenceCheckSync(node, ctx);
  }

  let value = getBaseVariableValue(node, ctx);
  // Use accessChain but skip bracket accesses (require async evaluation)
  for (const access of node.accessChain) {
    if (isBracketAccess(access)) {
      // Bracket accesses require async evaluation - skip in sync context
      continue;
    }
    if (value === null) {
      // Can't apply default in sync context (may need async evaluation)
      return null;
    }
    const field = resolveFieldAccess(access, value, ctx);
    value = accessField(value, field);
  }
  return value;
}

/**
 * Sync version of existence check for simple (non-computed/block) access.
 */
function evaluateExistenceCheckSync(
  node: VariableNode,
  ctx: RuntimeContext
): boolean {
  if (!node.existenceCheck) return false;

  let value = getBaseVariableValue(node, ctx);

  // Use accessChain but skip bracket accesses (require async evaluation)
  for (const access of node.accessChain) {
    if (isBracketAccess(access)) {
      // Bracket accesses require async evaluation - skip in sync context
      continue;
    }
    if (value === null) return false;
    const field = resolveFieldAccess(access, value, ctx);
    value = accessField(value, field);
  }

  if (value === null) return false;

  const finalField = resolveFieldAccess(
    node.existenceCheck.finalAccess,
    value,
    ctx
  );
  const finalValue = accessField(value, finalField);

  if (finalValue === null) return false;

  if (node.existenceCheck.typeName) {
    return checkType(finalValue, node.existenceCheck.typeName);
  }

  return true;
}

async function evaluateVariableAsync(
  node: VariableNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Handle existence check: .?path returns boolean
  if (node.existenceCheck) {
    return evaluateExistenceCheck(node, ctx);
  }

  let value = getBaseVariableValue(node, ctx);

  // Apply unified access chain (maintains order of dot and bracket accesses)
  for (const access of node.accessChain) {
    // If value is null/missing, either use default or continue with null
    if (value === null) {
      if (node.defaultValue) {
        return evaluateBody(node.defaultValue, ctx);
      }
      return null;
    }

    // Check if this is a bracket access
    if (isBracketAccess(access)) {
      const indexValue = await evaluatePipeChain(access.expression, ctx);
      if (typeof indexValue !== 'number') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Bracket index must be number, got ${inferType(indexValue)}`,
          node.span.start,
          {}
        );
      }

      // Handle negative indices (from end)
      let index = indexValue;
      if (index < 0) {
        if (Array.isArray(value)) {
          index = value.length + index;
        } else if (typeof value === 'string') {
          index = value.length + index;
        }
      }

      value = accessField(value, index);
    } else {
      // Field access
      const field = await resolveFieldAccessAsync(access, value, ctx);
      value = accessField(value, field);

      if (isCallable(value) && value.isProperty && value.boundDict) {
        value = await invokeCallable(value, [], ctx, node.span.start);
      }
    }
  }

  // Apply default if final value is null
  if (value === null && node.defaultValue) {
    return evaluateBody(node.defaultValue, ctx);
  }

  return value;
}

/**
 * Type guard to check if a PropertyAccess is a BracketAccess
 */
function isBracketAccess(access: PropertyAccess): access is BracketAccess {
  return 'accessKind' in access && access.accessKind === 'bracket';
}

/**
 * Evaluate existence check: $data.user.?email or $data.user.?email&string
 * Returns true if path exists (and optionally matches type), false otherwise.
 */
async function evaluateExistenceCheck(
  node: VariableNode,
  ctx: RuntimeContext
): Promise<boolean> {
  if (!node.existenceCheck) return false;

  let value = getBaseVariableValue(node, ctx);

  // Traverse the path up to (but not including) the final existence check
  for (const access of node.accessChain) {
    if (value === null) return false; // Missing intermediate path

    if (isBracketAccess(access)) {
      const indexValue = await evaluatePipeChain(access.expression, ctx);
      if (typeof indexValue !== 'number') return false;

      let index = indexValue;
      if (index < 0) {
        if (Array.isArray(value)) {
          index = value.length + index;
        } else if (typeof value === 'string') {
          index = value.length + index;
        }
      }
      value = accessField(value, index);
    } else {
      const field = await resolveFieldAccessAsync(access, value, ctx);
      value = accessField(value, field);
    }
  }

  // Now check the final element
  if (value === null) return false;

  const finalField = await resolveFieldAccessAsync(
    node.existenceCheck.finalAccess,
    value,
    ctx
  );
  const finalValue = accessField(value, finalField);

  // Check if exists
  if (finalValue === null) return false;

  // If type check required, verify type matches
  if (node.existenceCheck.typeName) {
    return checkType(finalValue, node.existenceCheck.typeName);
  }

  return true;
}

async function resolveFieldAccessAsync(
  access: FieldAccess,
  value: RillValue,
  ctx: RuntimeContext
): Promise<string | number> {
  switch (access.kind) {
    case 'literal':
      return access.field;
    case 'variable': {
      const varValue = getVariable(ctx, access.variableName);
      if (typeof varValue === 'string') return varValue;
      if (typeof varValue === 'number') return varValue;
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Variable field access requires string or number, got ${typeof varValue}`,
        undefined,
        {}
      );
    }
    case 'alternatives': {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const dict = value as Record<string, RillValue>;
        for (const alt of access.alternatives) {
          if (alt in dict) return alt;
        }
      }
      return access.alternatives[0] ?? '';
    }
    case 'computed': {
      const result = await evaluatePipeChain(access.expression, ctx);
      if (typeof result === 'string') return result;
      if (typeof result === 'number') return result;
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Computed field access requires string or number result`,
        undefined,
        {}
      );
    }
    case 'block': {
      const result = await evaluateBlock(access.block, ctx);
      if (typeof result === 'string') return result;
      if (typeof result === 'number') return result;
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Block field access requires string or number result`,
        undefined,
        {}
      );
    }
  }
}

function accessField(value: RillValue, field: string | number): RillValue {
  if (value === null) return null;

  if (typeof field === 'number') {
    if (Array.isArray(value)) return value[field] ?? null;
    if (typeof value === 'string') return value[field] ?? '';
    return null;
  }

  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !isScriptCallable(value)
  ) {
    return (value as Record<string, RillValue>)[field] ?? null;
  }

  return null;
}

// ============================================================
// FUNCTION & METHOD EVALUATION
// ============================================================

async function evaluateHostCall(
  node: HostCallNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  checkAborted(ctx, node);

  const fn = ctx.functions.get(node.name);
  if (!fn) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_UNDEFINED_FUNCTION,
      `Unknown function: ${node.name}`,
      getNodeLocation(node),
      { functionName: node.name }
    );
  }

  const args = await evaluateArgs(node.args, ctx);

  if (args.length === 0 && ctx.pipeValue !== null) {
    args.push(ctx.pipeValue);
  }

  ctx.observability.onHostCall?.({ name: node.name, args });
  const startTime = Date.now();

  const location = getNodeLocation(node);
  const result = fn(args, ctx, location);
  let value: RillValue;
  if (result instanceof Promise) {
    value = await withTimeout(result, ctx.timeout, node.name, node);
  } else {
    value = result;
  }

  ctx.observability.onFunctionReturn?.({
    name: node.name,
    value,
    durationMs: Date.now() - startTime,
  });

  return value;
}

async function evaluateClosureCall(
  node: ClosureCallNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  return evaluateClosureCallWithPipe(node, ctx.pipeValue, ctx);
}

async function evaluateClosureCallWithPipe(
  node: ClosureCallNode,
  pipeInput: RillValue | null,
  ctx: RuntimeContext
): Promise<RillValue> {
  const closure = getVariable(ctx, node.name);
  if (!closure) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_UNDEFINED_VARIABLE,
      `Unknown variable: $${node.name}`,
      getNodeLocation(node),
      { variableName: node.name }
    );
  }

  if (!isCallable(closure)) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Variable $${node.name} is not a function (got ${typeof closure})`,
      getNodeLocation(node),
      { variableName: node.name, actualType: typeof closure }
    );
  }

  const args = await evaluateArgs(node.args, ctx);

  if (
    isScriptCallable(closure) &&
    args.length === 0 &&
    pipeInput !== null &&
    closure.params.length > 0
  ) {
    const firstParam = closure.params[0];
    if (firstParam?.defaultValue === null && !isCallable(pipeInput)) {
      args.push(pipeInput);
    }
  }

  return invokeCallable(closure, args, ctx, node.span.start);
}

async function invokeCallable(
  callable: RillCallable,
  args: RillValue[],
  ctx: RuntimeContext,
  callLocation?: SourceLocation
): Promise<RillValue> {
  checkAborted(ctx, undefined);

  if (callable.kind === 'script') {
    return invokeScriptCallable(callable, args, ctx, callLocation);
  } else {
    return invokeFnCallable(callable, args, ctx, callLocation);
  }
}

async function invokeFnCallable(
  callable: RuntimeCallable | ApplicationCallable,
  args: RillValue[],
  ctx: RuntimeContext,
  callLocation?: SourceLocation
): Promise<RillValue> {
  const effectiveArgs =
    callable.boundDict && args.length === 0 ? [callable.boundDict] : args;

  const result = callable.fn(effectiveArgs, ctx, callLocation);
  return result instanceof Promise ? await result : result;
}

// ============================================================
// CALLABLE INVOCATION HELPERS
// ============================================================

function createCallableContext(
  callable: ScriptCallable,
  ctx: RuntimeContext
): RuntimeContext {
  // Create a child context with the defining scope as parent
  // This enables late-bound variable resolution through the scope chain
  const callableCtx: RuntimeContext = {
    ...ctx,
    parent: callable.definingScope as RuntimeContext,
    variables: new Map(),
    variableTypes: new Map(),
  };

  if (callable.boundDict) {
    callableCtx.pipeValue = callable.boundDict;
  }

  return callableCtx;
}

function inferTypeFromDefault(
  defaultValue: RillValue | null
): 'string' | 'number' | 'bool' | null {
  if (defaultValue === null) return null;
  const t = inferType(defaultValue);
  return t === 'string' || t === 'number' || t === 'bool' ? t : null;
}

function validateParamType(
  param: CallableParam,
  value: RillValue,
  callLocation?: SourceLocation
): void {
  const expectedType =
    param.typeName ?? inferTypeFromDefault(param.defaultValue);
  if (expectedType !== null) {
    const valueType = inferType(value);
    if (valueType !== expectedType) {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Parameter type mismatch: ${param.name} expects ${expectedType}, got ${valueType}`,
        callLocation,
        { paramName: param.name, expectedType, actualType: valueType }
      );
    }
  }
}

async function invokeScriptCallable(
  callable: ScriptCallable,
  args: RillValue[],
  ctx: RuntimeContext,
  callLocation?: SourceLocation
): Promise<RillValue> {
  const firstArg = args[0];
  if (args.length === 1 && firstArg !== undefined && isTuple(firstArg)) {
    return invokeScriptCallableWithArgs(callable, firstArg, ctx, callLocation);
  }

  const callableCtx = createCallableContext(callable, ctx);

  for (let i = 0; i < callable.params.length; i++) {
    const param = callable.params[i]!;
    let value: RillValue;

    if (i < args.length) {
      value = args[i]!;
    } else if (param.defaultValue !== null) {
      value = param.defaultValue;
    } else {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Missing argument for parameter '${param.name}' at position ${i}`,
        callLocation,
        { paramName: param.name, position: i }
      );
    }

    validateParamType(param, value, callLocation);
    callableCtx.variables.set(param.name, value);
  }

  return evaluateBodyExpression(callable.body, callableCtx);
}

async function invokeScriptCallableWithArgs(
  closure: ScriptCallable,
  tupleValue: RillTuple,
  ctx: RuntimeContext,
  callLocation?: SourceLocation
): Promise<RillValue> {
  const closureCtx = createCallableContext(closure, ctx);

  const hasNumericKeys = [...tupleValue.entries.keys()].some(
    (k) => typeof k === 'number'
  );
  const hasStringKeys = [...tupleValue.entries.keys()].some(
    (k) => typeof k === 'string'
  );

  if (hasNumericKeys && hasStringKeys) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      'Tuple cannot mix positional (numeric) and named (string) keys',
      callLocation
    );
  }

  const boundParams = new Set<string>();

  if (hasNumericKeys) {
    for (const [key, value] of tupleValue.entries) {
      const position = key as number;
      const param = closure.params[position];

      if (param === undefined) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Extra argument at position ${position} (closure has ${closure.params.length} params)`,
          callLocation,
          { position, paramCount: closure.params.length }
        );
      }

      validateParamType(param, value, callLocation);
      closureCtx.variables.set(param.name, value);
      boundParams.add(param.name);
    }
  } else if (hasStringKeys) {
    const paramNames = new Set(closure.params.map((p) => p.name));

    for (const [key, value] of tupleValue.entries) {
      const name = key as string;

      if (!paramNames.has(name)) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Unknown argument '${name}' (valid params: ${[...paramNames].join(', ')})`,
          callLocation,
          { argName: name, validParams: [...paramNames] }
        );
      }

      const param = closure.params.find((p) => p.name === name)!;
      validateParamType(param, value, callLocation);
      closureCtx.variables.set(name, value);
      boundParams.add(name);
    }
  }

  for (const param of closure.params) {
    if (!boundParams.has(param.name)) {
      if (param.defaultValue !== null) {
        closureCtx.variables.set(param.name, param.defaultValue);
      } else {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `Missing argument '${param.name}' (no default value)`,
          callLocation,
          { paramName: param.name }
        );
      }
    }
  }

  return evaluateBodyExpression(closure.body, closureCtx);
}

async function evaluatePipeInvoke(
  node: PipeInvokeNode,
  input: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  if (!isScriptCallable(input)) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Cannot invoke non-closure value (got ${typeof input})`,
      getNodeLocation(node)
    );
  }

  const args = await evaluateArgs(node.args, ctx);

  return invokeScriptCallable(input, args, ctx, node.span.start);
}

async function evaluateMethod(
  node: MethodCallNode | InvokeNode,
  receiver: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  checkAborted(ctx, node);

  // Handle postfix invocation: expr(args) - calls receiver as a closure
  if (node.type === 'Invoke') {
    return evaluateInvoke(node, receiver, ctx);
  }

  if (isCallable(receiver)) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Method .${node.name} not available on callable (invoke with -> $() first)`,
      getNodeLocation(node),
      { methodName: node.name, receiverType: 'callable' }
    );
  }

  const args = await evaluateArgs(node.args, ctx);

  if (isDict(receiver)) {
    const dictValue = receiver[node.name];
    if (dictValue !== undefined && isCallable(dictValue)) {
      return invokeCallable(dictValue, args, ctx, getNodeLocation(node));
    }
  }

  const method = ctx.methods.get(node.name);
  if (!method) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_UNDEFINED_METHOD,
      `Unknown method: ${node.name}`,
      getNodeLocation(node),
      { methodName: node.name }
    );
  }

  const result = method(receiver, args, ctx, getNodeLocation(node));
  return result instanceof Promise ? await result : result;
}

/**
 * Evaluate postfix invocation: expr(args)
 * Calls the receiver value as a closure with the given arguments.
 */
async function evaluateInvoke(
  node: InvokeNode,
  receiver: RillValue,
  ctx: RuntimeContext
): Promise<RillValue> {
  if (!isCallable(receiver)) {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Cannot invoke non-callable value (got ${inferType(receiver)})`,
      getNodeLocation(node),
      { actualType: inferType(receiver) }
    );
  }

  const args = await evaluateArgs(node.args, ctx);
  return invokeCallable(receiver, args, ctx, getNodeLocation(node));
}

// ============================================================
// CONTROL FLOW EVALUATION
// ============================================================

async function evaluateConditional(
  node: ConditionalNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Preserve pipe value before evaluating condition (condition may modify it)
  const savedPipeValue = ctx.pipeValue;

  let conditionResult: boolean;
  if (node.condition) {
    const conditionValue = await evaluateBodyExpression(node.condition, ctx);
    conditionResult = isTruthy(conditionValue);
  } else {
    conditionResult = isTruthy(ctx.pipeValue);
  }

  // Restore pipe value for then/else branch evaluation
  ctx.pipeValue = savedPipeValue;

  if (conditionResult) {
    // Create child scope for then branch (reads parent, writes local only)
    const thenCtx = createChildContext(ctx);
    thenCtx.pipeValue = savedPipeValue;
    // Use evaluateBody (not evaluateBodyExpression) so ReturnSignal
    // propagates up to the containing block rather than being caught here
    return evaluateBody(node.thenBranch, thenCtx);
  } else if (node.elseBranch) {
    // Create child scope for else branch (reads parent, writes local only)
    const elseCtx = createChildContext(ctx);
    elseCtx.pipeValue = savedPipeValue;
    if (node.elseBranch.type === 'Conditional') {
      return evaluateConditional(node.elseBranch, elseCtx);
    }
    return evaluateBody(node.elseBranch, elseCtx);
  }

  return ctx.pipeValue;
}

/**
 * Evaluate a loop (unified while/for-each).
 *
 * New syntax: input @ body
 *   - If input is bool: while loop (re-evaluate input each iteration)
 *   - If input is list/string: for-each (iterate over elements)
 *   - If no input: for-each over $ (current pipe value)
 */
async function evaluateForLoop(
  node: ForLoopNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Save original pipe value before evaluating input expression
  // (evaluating the input may modify ctx.pipeValue)
  const originalPipeValue = ctx.pipeValue;

  // Evaluate input expression (or use $ if no input)
  let input: RillValue;
  if (node.input) {
    input = await evaluateExpression(node.input, ctx);
    // Restore original pipe value for loop body
    ctx.pipeValue = originalPipeValue;
  } else {
    input = ctx.pipeValue;
  }

  // Runtime type determines loop behavior
  if (typeof input === 'boolean') {
    // While loop: re-evaluate input expression each iteration
    return evaluateWhileLoopMode(node, input, ctx);
  }

  // For-each loop: iterate over list or string
  // Each iteration creates a child scope (reads parent, writes local only)
  const results: RillValue[] = [];
  try {
    if (Array.isArray(input)) {
      for (const item of input) {
        checkAborted(ctx, node);
        const iterCtx = createChildContext(ctx);
        iterCtx.pipeValue = item;
        results.push(await evaluateBody(node.body, iterCtx));
      }
    } else if (typeof input === 'string') {
      for (const char of input) {
        checkAborted(ctx, node);
        const iterCtx = createChildContext(ctx);
        iterCtx.pipeValue = char;
        results.push(await evaluateBody(node.body, iterCtx));
      }
    } else if (isDict(input)) {
      // Iterate over dict entries as { key, value } objects
      const keys = Object.keys(input).sort();
      for (const key of keys) {
        checkAborted(ctx, node);
        const iterCtx = createChildContext(ctx);
        iterCtx.pipeValue = { key, value: input[key]! };
        results.push(await evaluateBody(node.body, iterCtx));
      }
    } else {
      // Non-iterable: execute body once with input as $
      checkAborted(ctx, node);
      const iterCtx = createChildContext(ctx);
      iterCtx.pipeValue = input;
      results.push(await evaluateBody(node.body, iterCtx));
    }
  } catch (e) {
    if (e instanceof BreakSignal) {
      return e.value;
    }
    throw e;
  }

  return results;
}

/**
 * While loop mode: condition is re-evaluated each iteration.
 * Each iteration creates a child scope (reads parent, writes local only).
 */
async function evaluateWhileLoopMode(
  node: ForLoopNode,
  initialCondition: boolean,
  ctx: RuntimeContext
): Promise<RillValue> {
  let value = ctx.pipeValue;
  let iterCount = 0;
  const maxIter = getIterationLimit(ctx);

  try {
    let conditionResult = initialCondition;
    while (conditionResult) {
      iterCount++;
      if (iterCount > maxIter) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_LIMIT_EXCEEDED,
          `While loop exceeded ${maxIter} iterations`,
          getNodeLocation(node),
          { limit: maxIter, iterations: iterCount }
        );
      }
      checkAborted(ctx, node);

      // Create child scope for this iteration
      const iterCtx = createChildContext(ctx);
      iterCtx.pipeValue = value;
      value = await evaluateBody(node.body, iterCtx);
      ctx.pipeValue = value;

      // Re-evaluate the input expression for next iteration
      if (node.input) {
        const nextCondition = await evaluateExpression(node.input, ctx);
        conditionResult =
          typeof nextCondition === 'boolean' ? nextCondition : false;
        // Restore pipeValue after condition evaluation (condition may have modified it)
        ctx.pipeValue = value;
      } else {
        // No input expression - use $ truthiness
        conditionResult = isTruthy(ctx.pipeValue);
      }
    }
  } catch (e) {
    if (e instanceof BreakSignal) {
      return e.value;
    }
    throw e;
  }

  return value;
}

async function evaluateDoWhileLoop(
  node: DoWhileLoopNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  let value = ctx.pipeValue;

  try {
    // Do-while: body executes first, then condition is checked
    // Each iteration creates a child scope (reads parent, writes local only)
    let shouldContinue = true;
    while (shouldContinue) {
      checkAborted(ctx, node);

      const iterCtx = createChildContext(ctx);
      iterCtx.pipeValue = value;
      value = await evaluateBody(node.body, iterCtx);
      ctx.pipeValue = value;

      const conditionValue = await evaluateBodyExpression(node.condition, ctx);
      shouldContinue = isTruthy(conditionValue);
    }
  } catch (e) {
    if (e instanceof BreakSignal) {
      return e.value;
    }
    throw e;
  }

  return value;
}

async function evaluateBlock(
  node: BlockNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Create child scope: reads from parent, writes to local only
  const childCtx = createChildContext(ctx);
  let lastValue: RillValue = childCtx.pipeValue;

  for (const stmt of node.statements) {
    lastValue = await executeStatement(stmt, childCtx);
  }

  return lastValue;
}

async function evaluateBlockExpression(
  node: BlockNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  try {
    return await evaluateBlock(node, ctx);
  } catch (e) {
    if (e instanceof ReturnSignal) {
      return e.value;
    }
    throw e;
  }
}

/**
 * Evaluate a simple body (Block, GroupedExpr, or PostfixExpr).
 * Used by conditionals and loops.
 */
async function evaluateBody(
  node: BodyNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  switch (node.type) {
    case 'Block':
      return evaluateBlock(node, ctx);
    case 'GroupedExpr':
      return evaluateGroupedExpr(node, ctx);
    case 'PostfixExpr':
      return evaluatePostfixExpr(node, ctx);
    case 'PipeChain':
      return evaluatePipeChain(node, ctx);
  }
}

/**
 * Evaluate a simple body as an expression (catches ReturnSignal).
 */
async function evaluateBodyExpression(
  node: BodyNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  try {
    return await evaluateBody(node, ctx);
  } catch (e) {
    if (e instanceof ReturnSignal) {
      return e.value;
    }
    throw e;
  }
}

// ============================================================
// EXPRESSION EVALUATION (arithmetic, comparison, logical)
// ============================================================

async function evaluateBinaryExpr(
  node: BinaryExprNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  const { op } = node;

  // Logical operators with short-circuit evaluation
  if (op === '||') {
    const left = await evaluateExprHead(node.left, ctx);
    if (isTruthy(left)) return true;
    const right = await evaluateExprHead(node.right, ctx);
    return isTruthy(right);
  }

  if (op === '&&') {
    const left = await evaluateExprHead(node.left, ctx);
    if (!isTruthy(left)) return false;
    const right = await evaluateExprHead(node.right, ctx);
    return isTruthy(right);
  }

  // Comparison operators - work on any values, return boolean
  if (
    op === '==' ||
    op === '!=' ||
    op === '<' ||
    op === '>' ||
    op === '<=' ||
    op === '>='
  ) {
    const left = await evaluateExprHead(node.left, ctx);
    const right = await evaluateExprHead(node.right, ctx);
    return evaluateBinaryComparison(left, right, op, node);
  }

  // Arithmetic operators - require numbers
  const left = await evaluateExprHeadNumber(node.left, ctx);
  const right = await evaluateExprHeadNumber(node.right, ctx);

  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'Division by zero',
          node.span.start
        );
      }
      return left / right;
    case '%':
      if (right === 0) {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          'Modulo by zero',
          node.span.start
        );
      }
      return left % right;
  }
}

/** Evaluate comparison between two values */
function evaluateBinaryComparison(
  left: RillValue,
  right: RillValue,
  op: '==' | '!=' | '<' | '>' | '<=' | '>=',
  node: BinaryExprNode
): boolean {
  switch (op) {
    case '==':
      return deepEquals(left, right);
    case '!=':
      return !deepEquals(left, right);
    case '<':
    case '>':
    case '<=':
    case '>=':
      // Ordering comparisons require compatible types
      if (typeof left === 'number' && typeof right === 'number') {
        return op === '<'
          ? left < right
          : op === '>'
            ? left > right
            : op === '<='
              ? left <= right
              : left >= right;
      }
      if (typeof left === 'string' && typeof right === 'string') {
        return op === '<'
          ? left < right
          : op === '>'
            ? left > right
            : op === '<='
              ? left <= right
              : left >= right;
      }
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Cannot compare ${inferType(left)} with ${inferType(right)} using ${op}`,
        node.span.start
      );
  }
}

async function evaluateUnaryExpr(
  node: UnaryExprNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  if (node.op === '!') {
    const value = await evaluateExprHead(node.operand, ctx);
    return !isTruthy(value);
  }

  // Unary minus
  const operand = node.operand;
  if (operand.type === 'UnaryExpr') {
    const inner = await evaluateUnaryExpr(operand, ctx);
    if (typeof inner !== 'number') {
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
        `Unary minus requires number, got ${inferType(inner)}`,
        node.span.start
      );
    }
    return -inner;
  }
  const value = await evaluateExprHeadNumber(operand, ctx);
  return -value;
}

/** Evaluate expression head, returning any RillValue */
async function evaluateExprHead(
  node: ArithHead,
  ctx: RuntimeContext
): Promise<RillValue> {
  switch (node.type) {
    case 'BinaryExpr':
      return evaluateBinaryExpr(node, ctx);
    case 'UnaryExpr':
      return evaluateUnaryExpr(node, ctx);
    case 'PostfixExpr':
      return evaluatePostfixExpr(node, ctx);
  }
}

/** Evaluate expression head, requiring a number result */
async function evaluateExprHeadNumber(
  node: ArithHead,
  ctx: RuntimeContext
): Promise<number> {
  const value = await evaluateExprHead(node, ctx);
  if (typeof value !== 'number') {
    throw new RuntimeError(
      RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
      `Arithmetic requires number, got ${inferType(value)}`,
      node.span.start
    );
  }
  return value;
}

async function evaluateGroupedExpr(
  node: GroupedExprNode,
  ctx: RuntimeContext
): Promise<RillValue> {
  // Grouped expressions have their own scope (reads parent, writes local only)
  const childCtx = createChildContext(ctx);
  return evaluatePipeChain(node.expression, childCtx);
}
