/**
 * CollectionsMixin: each/map/fold/filter
 *
 * Handles collection operators:
 * - Each: sequential iteration with all results (partial results on break)
 * - Map: parallel iteration with all results
 * - Fold: sequential reduction to final value
 * - Filter: parallel filtering by predicate
 *
 * Interface requirements (from spec):
 * - evaluateEach(node, input) -> Promise<RillValue[]>
 * - evaluateMap(node, input) -> Promise<RillValue[]>
 * - evaluateFold(node, input) -> Promise<RillValue>
 * - evaluateFilter(node, input) -> Promise<RillValue[]>
 *
 * Error Handling:
 * - Non-iterable inputs throw RuntimeError(RUNTIME_TYPE_ERROR) [EC-10]
 * - Iterator body evaluation errors propagate correctly [EC-11]
 * - Iteration limit exceeded throws RuntimeError [EC-12]
 *
 * @internal
 */

import type {
  EachExprNode,
  MapExprNode,
  FoldExprNode,
  FilterExprNode,
  IteratorBody,
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { isIterator, isStream, isVector } from '../../types/guards.js';
import type { RillStream } from '../../types/structures.js';
import { createChildContext, getVariable } from '../../context.js';
import { BreakSignal } from '../../signals.js';
import { isCallable, isDict, marshalArgs } from '../../callable.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import { getEvaluator } from '../evaluator.js';

/**
 * Default maximum iteration count for iterators.
 * Can be overridden with ^(limit: N) annotation.
 */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * CollectionsMixin implementation.
 *
 * Evaluates collection operators: each, map, fold, filter.
 * Handles iteration over lists, strings, dicts, iterators, and streams.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluateBlockExpression() (from ControlFlowMixin)
 * - evaluateGroupedExpr() (from ExpressionsMixin)
 * - evaluateVariableAsync() (from VariablesMixin)
 * - evaluatePrimary() (from future CoreMixin composition)
 * - invokeCallable() (from future CoreMixin composition)
 * - createClosure() (from future CoreMixin composition)
 *
 * Methods added:
 * - evaluateEach(node, input) -> Promise<RillValue[]>
 * - evaluateMap(node, input) -> Promise<RillValue[]>
 * - evaluateFold(node, input) -> Promise<RillValue>
 * - evaluateFilter(node, input) -> Promise<RillValue[]>
 * - getIterableElements(input) -> Promise<RillValue[]> (helper)
 * - evaluateIteratorBody(body, element, accumulator) -> Promise<RillValue> (helper)
 * - expandIterator(iterator, limit?) -> Promise<RillValue[]> (helper)
 * - expandStream(stream, node, limit?) -> Promise<RillValue[]> (helper)
 */
function createCollectionsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class CollectionsEvaluator extends Base {
    /**
     * Get elements from an iterable value (list, string, dict, iterator, or stream).
     * Throws RuntimeError if value is not iterable.
     */
    protected async getIterableElements(
      input: RillValue,
      node: { span: { start: SourceLocation } }
    ): Promise<RillValue[]> {
      // Vector guard [EC-32]
      if (isVector(input)) {
        throw new RuntimeError(
          'RILL-R003',
          'Collection operators require list, string, dict, iterator, or stream, got vector',
          node.span.start
        );
      }
      if (Array.isArray(input)) {
        return input;
      }
      if (typeof input === 'string') {
        return [...input];
      }
      // Check for stream BEFORE iterator (streams satisfy iterator shape)
      if (isStream(input)) {
        return this.expandStream(input, node);
      }
      // Check for iterator protocol BEFORE generic dict handling
      if (isIterator(input)) {
        return this.expandIterator(input, node);
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
        'RILL-R002',
        `Collection operators require list, string, dict, iterator, or stream, got ${inferType(input)}`,
        node.span.start
      );
    }

    /**
     * Expand an iterator to a list of values.
     * Respects iteration limits to prevent infinite loops.
     */
    protected async expandIterator(
      iterator: RillValue,
      node: { span: { start: SourceLocation } },
      limit: number = DEFAULT_MAX_ITERATIONS
    ): Promise<RillValue[]> {
      const elements: RillValue[] = [];
      let current = iterator as Record<string, RillValue>;
      let count = 0;

      while (!current['done'] && count < limit) {
        this.checkAborted();
        const val = current['value'];
        if (val !== undefined) {
          elements.push(val);
        }
        count++;

        // Invoke next() to get the next iterator
        const nextClosure = current['next'];
        if (nextClosure === undefined || !isCallable(nextClosure)) {
          throw new RuntimeError(
            'RILL-R002',
            'Iterator .next must be a closure',
            node.span.start
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nextIterator = await (this as any).invokeCallable(
          nextClosure,
          [],
          this.ctx,
          node.span.start
        );
        if (typeof nextIterator !== 'object' || nextIterator === null) {
          throw new RuntimeError(
            'RILL-R002',
            'Iterator .next must return iterator',
            node.span.start
          );
        }
        current = nextIterator as Record<string, RillValue>;
      }

      if (count >= limit) {
        throw new RuntimeError(
          'RILL-R010',
          `Iterator expansion exceeded ${limit} iterations`,
          node.span.start,
          { limit, iterations: count }
        );
      }

      return elements;
    }

    /**
     * Expand a stream to a list of chunk values.
     * Consumes async chunks by repeatedly calling the stream's next callable.
     * Respects iteration limits to prevent unbounded expansion.
     *
     * On BreakSignal, calls the stream's dispose callable (if present)
     * before re-throwing (NFR-STREAM-2).
     */
    protected async expandStream(
      stream: RillStream,
      node: { span: { start: SourceLocation } },
      limit: number = DEFAULT_MAX_ITERATIONS
    ): Promise<RillValue[]> {
      const elements: RillValue[] = [];
      let current: RillStream = stream;
      let count = 0;
      let expectedType: string | undefined;

      try {
        while (!current.done && count < limit) {
          this.checkAborted();
          const val = current['value'];
          if (val !== undefined) {
            const actualType = inferType(val);
            if (expectedType === undefined) {
              expectedType = actualType;
            } else if (actualType !== expectedType) {
              throw new RuntimeError(
                'RILL-R004',
                `Stream chunk type mismatch: expected ${expectedType}, got ${actualType}`,
                node.span.start
              );
            }
            elements.push(val);
          }
          count++;

          // Invoke next() to advance the stream
          const nextClosure = current['next'];
          if (nextClosure === undefined || !isCallable(nextClosure)) {
            throw new RuntimeError(
              'RILL-R002',
              'Stream .next must be a closure',
              node.span.start
            );
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nextStep = await (this as any).invokeCallable(
            nextClosure,
            [],
            this.ctx,
            node.span.start
          );
          if (typeof nextStep !== 'object' || nextStep === null) {
            throw new RuntimeError(
              'RILL-R002',
              'Stream .next must return a stream step',
              node.span.start
            );
          }
          current = nextStep as RillStream;
        }
      } catch (e) {
        if (e instanceof BreakSignal) {
          // Dispose stream resources before re-throwing (IR-14)
          // Access __rill_stream_dispose on the original stream object
          // (step objects don't carry dispose; it lives on the root stream)
          const disposeFn = (
            stream as unknown as Record<string, (() => void) | undefined>
          )['__rill_stream_dispose'];
          if (typeof disposeFn === 'function') {
            try {
              disposeFn();
            } catch (disposeErr) {
              // Propagate dispose errors as RILL-R002 (EC-15)
              if (disposeErr instanceof RuntimeError) throw disposeErr;
              throw new RuntimeError(
                'RILL-R002',
                disposeErr instanceof Error
                  ? disposeErr.message
                  : String(disposeErr),
                node.span.start
              );
            }
          }
          throw e;
        }
        throw e;
      }

      if (count >= limit) {
        throw new RuntimeError(
          'RILL-R010',
          `Stream expansion exceeded ${limit} iterations`,
          node.span.start,
          { limit, iterations: count }
        );
      }

      return elements;
    }

    /**
     * Evaluate collection body for a single element.
     * Handles all body forms: closure, block, grouped, variable, postfix, spread.
     *
     * NOTE: For sequential operations (each/fold), caller creates child context,
     * sets pipeValue, and swaps this.ctx. For parallel operations (map/filter),
     * caller passes a separate evaluator instance with isolated context.
     */
    protected async evaluateIteratorBody(
      body: IteratorBody,
      element: RillValue,
      accumulator: RillValue | null
    ): Promise<RillValue> {
      switch (body.type) {
        case 'Closure': {
          // Inline closure: invoke with element (and accumulator if present in params)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const closure = await (this as any).createClosure(body, this.ctx);
          const args: RillValue[] = [element];
          // Accumulator is passed as second arg if closure has 2+ params
          if (accumulator !== null && closure.params.length >= 2) {
            args.push(accumulator);
          }
          // Create context with $@ for closures that use it (e.g., |x| { $x + $@ })
          let invokeCtx = this.ctx;
          let closureToInvoke = closure;
          if (accumulator !== null) {
            invokeCtx = createChildContext(this.ctx);
            invokeCtx.variables.set('@', accumulator);
            // Create new closure with updated definingScope to include $@
            closureToInvoke = { ...closure, definingScope: invokeCtx };
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).invokeCallable(
            closureToInvoke,
            args,
            invokeCtx,
            body.span.start
          );
        }

        case 'Block': {
          // Block: evaluate with $ = element, $@ = accumulator
          // this.ctx already has pipeValue set to element by caller
          if (accumulator !== null) {
            this.ctx.variables.set('@', accumulator);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluateBlockExpression(body);
        }

        case 'GroupedExpr': {
          // Grouped: evaluate with $ = element, $@ = accumulator (for fold)
          // this.ctx already has pipeValue set to element by caller
          if (accumulator !== null) {
            this.ctx.variables.set('@', accumulator);
          }
          // Evaluate the inner expression directly (don't call evaluateGroupedExpr,
          // which would create another child context)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluatePipeChain(body.expression);
        }

        case 'Variable': {
          // Bare $ = identity, return element unchanged
          if (body.isPipeVar && !body.name && body.accessChain.length === 0) {
            return element;
          }

          // $[idx] or $.field - evaluate access chain on current element
          // this.ctx already has pipeValue set to element by caller
          if (body.isPipeVar && body.accessChain.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (this as any).evaluateVariableAsync(body);
          }

          // Variable closure: get closure and invoke with element
          const varValue = getVariable(this.ctx, body.name ?? '');
          if (!varValue) {
            throw new RuntimeError(
              'RILL-R005',
              `Undefined variable: $${body.name}`,
              body.span.start
            );
          }
          if (!isCallable(varValue)) {
            throw new RuntimeError(
              'RILL-R002',
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
          // Create context with $@ for accumulator access
          let invokeCtx = this.ctx;
          if (accumulator !== null) {
            invokeCtx = createChildContext(this.ctx);
            invokeCtx.variables.set('@', accumulator);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (this as any).invokeCallable(
            varValue,
            args,
            invokeCtx,
            body.span.start
          );
        }

        case 'PostfixExpr': {
          // PostfixExpr: evaluate with $ = element
          // this.ctx already has pipeValue set to element by caller
          if (accumulator !== null) {
            this.ctx.variables.set('@', accumulator);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluatePostfixExpr(body);
        }

        case 'HostCall': {
          // Host function call: invoke with element as first arg
          const fn = this.ctx.functions.get(body.name);
          if (!fn) {
            throw new RuntimeError(
              'RILL-R006',
              `Unknown function: ${body.name}`,
              body.span.start,
              { functionName: body.name }
            );
          }
          const args: RillValue[] = [element];
          if (accumulator !== null) {
            args.push(accumulator);
          }
          const fnToCall = typeof fn === 'function' ? fn : fn.fn;
          // Marshal args to named record if fn has params; cast otherwise (IC-1).
          const callArgs =
            typeof fn !== 'function' && fn.params !== undefined
              ? marshalArgs(args, fn.params, {
                  functionName: body.name,
                  location: body.span.start,
                })
              : (args as unknown as Record<string, RillValue>);
          return fnToCall(callArgs, this.ctx, body.span.start);
        }

        default: {
          // TypeScript exhaustiveness check - should never reach here
          const unknownBody = body as unknown as {
            type: string;
            span: { start: SourceLocation };
          };
          throw new RuntimeError(
            'RILL-R002',
            `Unsupported iterator body type: ${unknownBody.type}`,
            unknownBody.span.start
          );
        }
      }
    }

    /**
     * Evaluate each expression: sequential iteration returning list of all results.
     *
     * Syntax forms:
     *   collection -> each { body }              -- $ is element
     *   collection -> each(init) { $@ + $ }      -- $@ is accumulator (scan)
     *   collection -> each |x| body              -- inline closure
     *   collection -> each |x, acc = init| body  -- closure with accumulator
     *
     * Supports break for early termination (returns partial results).
     */
    protected async evaluateEach(
      node: EachExprNode,
      input: RillValue
    ): Promise<RillValue[]> {
      const elements = await this.getIterableElements(input, node);

      // Empty collection: return []
      if (elements.length === 0) {
        return [];
      }

      // Check for iteration limit annotation at operator level (node.annotations).
      // Statement-level annotationStack is not consulted (EC-5).
      const operatorAnnotations = node.annotations?.length
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluateAnnotations(node.annotations)
        : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maxIter = (this as any).getIterationLimit(operatorAnnotations);

      // Get initial accumulator value if present
      let accumulator: RillValue | null = null;
      if (node.accumulator) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        accumulator = await (this as any).evaluateExpression(node.accumulator);
      } else if (node.body.type === 'Closure' && node.body.params.length >= 2) {
        // Inline closure with accumulator: |x, acc = init| body
        const lastParam = node.body.params[node.body.params.length - 1];
        if (lastParam?.defaultValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          accumulator = await (this as any).evaluatePrimary(
            lastParam.defaultValue,
            this.ctx
          );
        }
      }

      const results: RillValue[] = [];
      let iterCount = 0;

      try {
        for (const element of elements) {
          iterCount++;
          if (iterCount > maxIter) {
            throw new RuntimeError(
              'RILL-R010',
              `Each loop exceeded ${maxIter} iterations`,
              node.span.start,
              { limit: maxIter, iterations: iterCount }
            );
          }
          this.checkAborted(node);

          // Create child context for this iteration
          const iterCtx = createChildContext(this.ctx);
          iterCtx.pipeValue = element;
          if (accumulator !== null) {
            iterCtx.variables.set('@', accumulator);
          }

          // Temporarily swap context
          const savedCtx = this.ctx;
          this.ctx = iterCtx;
          try {
            const result = await this.evaluateIteratorBody(
              node.body,
              element,
              accumulator
            );
            results.push(result);
            // Update accumulator for next iteration (scan pattern)
            if (accumulator !== null) {
              accumulator = result;
            }
          } finally {
            this.ctx = savedCtx;
          }
        }
      } catch (e) {
        if (e instanceof BreakSignal) {
          // Break: return partial results collected before break
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
     *
     * NOTE: Each iteration uses a separate evaluator instance with its own context
     * to avoid late binding issues in parallel execution. This ensures that each
     * iteration sees its own $ value without interference from other parallel iterations.
     */
    protected async evaluateMap(
      node: MapExprNode,
      input: RillValue
    ): Promise<RillValue[]> {
      const elements = await this.getIterableElements(input, node);

      // Empty collection: return []
      if (elements.length === 0) {
        return [];
      }

      // Check for concurrency limit annotation at operator level (node.annotations).
      // Statement-level annotationStack is not consulted (EC-5).
      const operatorAnnotations = node.annotations?.length
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluateAnnotations(node.annotations)
        : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const concurrencyLimit = (this as any).getIterationLimit(
        operatorAnnotations
      );
      const hasExplicitLimit = operatorAnnotations?.['limit'] !== undefined;

      if (!hasExplicitLimit) {
        // No limit: all in parallel
        // Create separate evaluator instance for each element to avoid late binding
        const promises = elements.map((element) => {
          const elementCtx = createChildContext(this.ctx);
          elementCtx.pipeValue = element;
          const evaluator = getEvaluator(elementCtx);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (evaluator as any).evaluateIteratorBody(
            node.body,
            element,
            null
          );
        });
        return Promise.all(promises);
      }

      // With limit: process in batches
      const results: RillValue[] = [];
      for (let i = 0; i < elements.length; i += concurrencyLimit) {
        this.checkAborted(node);
        const batch = elements.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map((element) => {
          const elementCtx = createChildContext(this.ctx);
          elementCtx.pipeValue = element;
          const evaluator = getEvaluator(elementCtx);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (evaluator as any).evaluateIteratorBody(
            node.body,
            element,
            null
          );
        });
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
    protected async evaluateFold(
      node: FoldExprNode,
      input: RillValue
    ): Promise<RillValue> {
      const elements = await this.getIterableElements(input, node);

      // Get initial accumulator value
      let accumulator: RillValue;
      if (node.accumulator) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        accumulator = await (this as any).evaluateExpression(node.accumulator);
      } else if (node.body.type === 'Closure' && node.body.params.length >= 2) {
        // Inline closure with accumulator: |x, acc = init| body
        const lastParam = node.body.params[node.body.params.length - 1];
        if (lastParam?.defaultValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          accumulator = await (this as any).evaluatePrimary(
            lastParam.defaultValue,
            this.ctx
          );
        } else {
          throw new RuntimeError(
            'RILL-R002',
            'Fold requires accumulator: use |x, acc = init| or fold(init) { }',
            node.span.start
          );
        }
      } else if (node.body.type === 'Variable' && !node.body.isPipeVar) {
        // Variable closure: the closure itself must have an accumulator default
        const varValue = getVariable(this.ctx, node.body.name ?? '');
        if (!varValue || !isCallable(varValue) || varValue.kind !== 'script') {
          throw new RuntimeError(
            'RILL-R002',
            'Fold variable must be a script closure with accumulator parameter',
            node.span.start
          );
        }
        const lastParam = varValue.params[varValue.params.length - 1];
        if (
          lastParam &&
          lastParam.defaultValue !== null &&
          lastParam.defaultValue !== undefined
        ) {
          accumulator = lastParam.defaultValue; // TODO(task-1.4): remove null check after migration
        } else {
          throw new RuntimeError(
            'RILL-R002',
            'Fold closure must have accumulator parameter with default value',
            node.span.start
          );
        }
      } else {
        throw new RuntimeError(
          'RILL-R002',
          'Fold requires accumulator: use |x, acc = init| or fold(init) { }',
          node.span.start
        );
      }

      // Check for iteration limit annotation at operator level (node.annotations).
      // Statement-level annotationStack is not consulted (EC-5).
      const operatorAnnotations = node.annotations?.length
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluateAnnotations(node.annotations)
        : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maxIter = (this as any).getIterationLimit(operatorAnnotations);

      // Empty collection: return initial accumulator
      if (elements.length === 0) {
        return accumulator;
      }

      let iterCount = 0;
      for (const element of elements) {
        iterCount++;
        if (iterCount > maxIter) {
          throw new RuntimeError(
            'RILL-R010',
            `Fold loop exceeded ${maxIter} iterations`,
            node.span.start,
            { limit: maxIter, iterations: iterCount }
          );
        }
        this.checkAborted(node);

        // Create child context for this iteration
        const iterCtx = createChildContext(this.ctx);
        iterCtx.pipeValue = element;
        iterCtx.variables.set('@', accumulator);

        // Temporarily swap context
        const savedCtx = this.ctx;
        this.ctx = iterCtx;
        try {
          accumulator = await this.evaluateIteratorBody(
            node.body,
            element,
            accumulator
          );
        } finally {
          this.ctx = savedCtx;
        }
      }

      return accumulator;
    }

    /**
     * Evaluate filter expression: parallel filtering, returns elements where predicate is truthy.
     *
     * Executes predicate for all elements concurrently.
     * Preserves original element order.
     * Empty collection: returns [].
     *
     * NOTE: Each iteration uses a separate evaluator instance with its own context
     * to avoid late binding issues in parallel execution.
     */
    protected async evaluateFilter(
      node: FilterExprNode,
      input: RillValue
    ): Promise<RillValue[]> {
      const elements = await this.getIterableElements(input, node);

      // Empty collection: return []
      if (elements.length === 0) {
        return [];
      }

      // Check for concurrency limit annotation at operator level (node.annotations).
      // Statement-level annotationStack is not consulted (EC-5).
      const operatorAnnotations = node.annotations?.length
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (this as any).evaluateAnnotations(node.annotations)
        : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const concurrencyLimit = (this as any).getIterationLimit(
        operatorAnnotations
      );
      const hasExplicitLimit = operatorAnnotations?.['limit'] !== undefined;

      /** Run the predicate for a single element and return keep/discard result. */
      const runPredicate = async (element: RillValue) => {
        this.checkAborted(node);
        const elementCtx = createChildContext(this.ctx);
        elementCtx.pipeValue = element;
        const evaluator = getEvaluator(elementCtx);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (evaluator as any).evaluateIteratorBody(
          node.body,
          element,
          null
        );
        // Predicate must return boolean
        if (typeof result !== 'boolean') {
          throw new RuntimeError(
            'RILL-R002',
            `Filter predicate must return boolean, got ${inferType(result)}`,
            node.span.start
          );
        }
        return { element, keep: result };
      };

      if (!hasExplicitLimit) {
        // No limit: all in parallel
        const results = await Promise.all(elements.map(runPredicate));
        return results.filter((r) => r.keep).map((r) => r.element);
      }

      // With limit: process in batches
      const kept: RillValue[] = [];
      for (let i = 0; i < elements.length; i += concurrencyLimit) {
        this.checkAborted(node);
        const batch = elements.slice(i, i + concurrencyLimit);
        const batchResults = await Promise.all(batch.map(runPredicate));
        for (const r of batchResults) {
          if (r.keep) kept.push(r.element);
        }
      }
      return kept;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CollectionsMixin = createCollectionsMixin as any;
