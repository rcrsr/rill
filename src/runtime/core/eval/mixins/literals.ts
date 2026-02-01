/**
 * LiteralsMixin: String, Tuple, Dict, and Closure Evaluation
 *
 * Handles evaluation of literal values including:
 * - String literals with interpolation
 * - Tuple literals
 * - Dict literals with callable binding
 * - Closure creation with late binding
 * - Block-closure creation for expression-position blocks
 *
 * Interface requirements (from spec):
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 *
 * Error Handling:
 * - String interpolation errors propagate from evaluateExpression() [EC-6]
 * - Dict/tuple evaluation errors propagate from nested expressions [EC-7]
 *
 * @internal
 */

import type {
  StringLiteralNode,
  TupleNode,
  DictNode,
  ClosureNode,
  BlockNode,
  PipeChainNode,
  PostfixExprNode,
  ExpressionNode,
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError, RILL_ERROR_CODES } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { formatValue, isReservedMethod } from '../../values.js';
import {
  isCallable,
  type ScriptCallable,
  type CallableParam,
} from '../../callable.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * LiteralsMixin implementation.
 *
 * Provides evaluation of literal values. String literals support interpolation,
 * closures are created with late binding, and dict callables are automatically
 * bound to their containing dict.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluatePrimary() (from future CoreMixin composition)
 *
 * Methods added:
 * - evaluateString(node) -> Promise<string>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 */
function createLiteralsMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class LiteralsEvaluator extends Base {
    /**
     * Evaluate string literal with interpolation.
     * Interpolation expressions are evaluated with the current pipe value preserved.
     *
     * String parts are concatenated with interpolated values formatted via formatValue().
     * Errors from interpolation expression evaluation propagate to caller.
     */
    protected async evaluateString(node: StringLiteralNode): Promise<string> {
      let result = '';
      // Save pipeValue since interpolation expressions can modify it
      const savedPipeValue = this.ctx.pipeValue;
      for (const part of node.parts) {
        if (typeof part === 'string') {
          result += part;
        } else {
          // InterpolationNode: evaluate the expression
          // Restore pipeValue before each interpolation so they all see the same value
          this.ctx.pipeValue = savedPipeValue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = await (this as any).evaluateExpression(part.expression);
          result += formatValue(value);
        }
      }
      // Restore pipeValue after string evaluation
      this.ctx.pipeValue = savedPipeValue;
      return result;
    }

    /**
     * Evaluate tuple literal.
     * Elements are evaluated in order and collected into an array.
     *
     * Errors from element evaluation propagate to caller.
     */
    protected async evaluateTuple(node: TupleNode): Promise<RillValue[]> {
      const elements: RillValue[] = [];
      for (const elem of node.elements) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        elements.push(await (this as any).evaluateExpression(elem));
      }
      return elements;
    }

    /**
     * Evaluate dict literal.
     * All callables in the dict are bound to the containing dict via boundDict property.
     *
     * Reserved method names (keys, values, entries) cannot be used as dict keys.
     * Multi-key entries (tuple keys) are not supported in dict literals, only in dispatch.
     * Errors from value evaluation propagate to caller.
     */
    protected async evaluateDict(
      node: DictNode
    ): Promise<Record<string, RillValue>> {
      const result: Record<string, RillValue> = {};
      for (const entry of node.entries) {
        // Multi-key entries (tuple keys) only valid in dict dispatch, not dict literals
        if (typeof entry.key !== 'string') {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            'Dict literal keys must be identifiers, not lists',
            entry.span.start,
            { entry }
          );
        }

        if (isReservedMethod(entry.key)) {
          throw new RuntimeError(
            RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
            `Cannot use reserved method name '${entry.key}' as dict key`,
            entry.span.start,
            { key: entry.key, reservedMethods: ['keys', 'values', 'entries'] }
          );
        }

        if (this.isBlockExpr(entry.value)) {
          // Safe cast: isBlockExpr ensures head is PostfixExpr with Block primary
          const head = entry.value.head as PostfixExprNode;
          const blockNode = head.primary as BlockNode;
          const closure = this.createBlockClosure(blockNode);
          result[entry.key] = closure;
        } else if (this.isClosureExpr(entry.value)) {
          // Safe cast: isClosureExpr ensures head is PostfixExpr with Closure primary
          const head = entry.value.head as PostfixExprNode;
          const fnLit = head.primary as ClosureNode;
          const closure = await this.createClosure(fnLit);
          result[entry.key] = closure;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result[entry.key] = await (this as any).evaluateExpression(
            entry.value
          );
        }
      }

      // Bind all callables to the containing dict
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

    /**
     * Evaluate dict as dispatch table when piped [IR-5].
     *
     * Searches dict entries for key matching piped value using deep equality.
     * Returns matched value. Auto-invokes if matched value is closure.
     *
     * Multi-key support: [["k1", "k2"]: value] syntax allows multiple keys
     * to map to the same value. Key tuple is evaluated to get list of candidates.
     * Validates multi-key entries per EC-13: tuple must evaluate to list.
     *
     * @param node - DictNode representing dispatch table
     * @param input - Piped value to use as lookup key
     * @returns Matched value (auto-invoked if closure)
     * @throws RuntimeError with RUNTIME_PROPERTY_NOT_FOUND if no match and no default
     * @throws RuntimeError with RUNTIME_TYPE_ERROR if multi-key is not list (EC-13)
     */
    protected async evaluateDictDispatch(
      node: DictNode,
      input: RillValue
    ): Promise<RillValue> {
      // Import deepEquals for key matching
      const { deepEquals } = await import('../../values.js');

      // Search entries for matching key
      for (const entry of node.entries) {
        let matchFound = false;

        if (typeof entry.key === 'string') {
          // Single string key - compare directly
          matchFound = deepEquals(input, entry.key);
        } else {
          // Tuple key - evaluate to get list of candidates
          // Parser ensures entry.key is TupleNode, evaluateTuple always returns array
          const keyValue = await this.evaluateTuple(entry.key);

          // Check if input matches any element in the list
          for (const candidate of keyValue) {
            if (deepEquals(input, candidate)) {
              matchFound = true;
              break;
            }
          }
        }

        if (matchFound) {
          // Found match - evaluate and return the value
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matchedValue = await (this as any).evaluateExpression(
            entry.value
          );
          return this.resolveDispatchValue(matchedValue, input, node);
        }
      }

      // No match found - check for default value
      if (node.defaultValue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).evaluateExpression(node.defaultValue);
      }

      // No match and no default - throw RUNTIME_PROPERTY_NOT_FOUND
      const location = node.span?.start;
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_PROPERTY_NOT_FOUND,
        `Dict dispatch: key '${formatValue(input)}' not found at line ${location?.line ?? '?'}:${location?.column ?? '?'}`,
        location,
        { key: input }
      );
    }

    /**
     * Evaluate list literal as dispatch table when piped.
     *
     * Takes numeric index and returns element at that position.
     * Supports negative indices and default values.
     *
     * @param node - TupleNode representing list literal
     * @param input - Piped value to use as index (must be number)
     * @returns Element at index
     * @throws RuntimeError if input not number or index out of bounds
     */
    protected async evaluateListDispatch(
      node: TupleNode,
      input: RillValue
    ): Promise<RillValue> {
      // Validate input is number
      if (typeof input !== 'number') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `List dispatch requires number index, got ${typeof input}`,
          node.span?.start,
          { input, expectedType: 'number' }
        );
      }

      // Evaluate all elements to get the list
      const elements = await this.evaluateTuple(node);

      // Truncate decimal to integer
      const index = Math.trunc(input);

      // Normalize negative indices
      const normalizedIndex = index < 0 ? elements.length + index : index;

      // Check bounds
      if (normalizedIndex < 0 || normalizedIndex >= elements.length) {
        // Check for default value
        if (node.defaultValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluateExpression(node.defaultValue);
        }

        // No match and no default - throw error
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_PROPERTY_NOT_FOUND,
          `List dispatch: index '${index}' not found`,
          node.span?.start,
          { index, listLength: elements.length }
        );
      }

      // Return element at normalized index
      return elements[normalizedIndex]!;
    }

    /**
     * Resolve dispatch value: auto-invoke if closure, otherwise return as-is.
     * Zero-param closures (block-closures) are invoked with args = [] and pipeValue = input.
     * Parameterized closures (1+ params) throw error.
     */
    private async resolveDispatchValue(
      value: RillValue,
      input: RillValue,
      node: DictNode
    ): Promise<RillValue> {
      if (isCallable(value)) {
        // Check for parameterized closure (explicit user-defined params)
        // Note: Block-closures have exactly 1 param named '$'
        // Parameterized closures have 1+ params with user-defined names
        if (value.kind === 'script' && value.params.length >= 1) {
          // Check if first param is '$' (block-closure) or user-defined (parameterized)
          if (value.params[0]!.name !== '$') {
            // Parameterized closure at terminal position: error
            throw new RuntimeError(
              RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
              'Dispatch does not provide arguments for parameterized closure',
              node.span?.start
            );
          }
        }

        // Check if callable has params to determine invocation style
        const hasParams =
          (value.kind === 'script' && value.params.length > 0) ||
          (value.kind === 'application' &&
            value.params !== undefined &&
            value.params.length > 0);

        if (hasParams) {
          // Application callable with params: invoke with input as argument
          // Note: Script callables with params already threw error above
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).invokeCallable(
            value,
            [input],
            node.span?.start
          );
        } else {
          // Zero-param closure: invoke with args = [] and pipeValue = input
          const savedPipeValue = this.ctx.pipeValue;
          this.ctx.pipeValue = input;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (this as any).invokeCallable(
              value,
              [],
              node.span?.start
            );
            return result;
          } finally {
            this.ctx.pipeValue = savedPipeValue;
          }
        }
      }
      return value;
    }

    /**
     * Runtime dict dispatch for variables: search dict for matching key.
     * Supports multi-key entries, auto-invokes closures, handles default values.
     *
     * @param dict - Runtime dict value
     * @param input - Key to search for
     * @param defaultValue - Optional default value expression node
     * @param location - Source location for error reporting
     * @returns Matched value or default
     */
    protected async dispatchToDict(
      dict: Record<string, RillValue>,
      input: RillValue,
      defaultValue: ExpressionNode | null,
      location: {
        span?: { start: SourceLocation; end: SourceLocation };
      },
      skipClosureResolution = false
    ): Promise<RillValue> {
      const { deepEquals } = await import('../../values.js');

      // Search dict entries for matching key
      for (const [key, value] of Object.entries(dict)) {
        // Simple key match using deep equality
        if (deepEquals(input, key)) {
          // Skip closure resolution for hierarchical dispatch (caller handles it)
          if (skipClosureResolution) {
            return value;
          }
          // Auto-invoke closures if needed
          return this.resolveDispatchValueRuntime(value, input, location);
        }
      }

      // No match found - check for default value
      if (defaultValue) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await (this as any).evaluateExpression(defaultValue);
      }

      // No match and no default - throw error
      const loc = location.span?.start;
      throw new RuntimeError(
        RILL_ERROR_CODES.RUNTIME_PROPERTY_NOT_FOUND,
        `Dict dispatch: key '${formatValue(input)}' not found at line ${loc?.line ?? '?'}:${loc?.column ?? '?'}`,
        loc,
        { key: input }
      );
    }

    /**
     * Runtime list dispatch for variables: return element at numeric index.
     * Supports negative indices, auto-invokes closures, handles default values.
     *
     * @param list - Runtime list value
     * @param input - Index value (must be number)
     * @param defaultValue - Optional default value expression node
     * @param location - Source location for error reporting
     * @returns Element at index or default
     */
    protected async dispatchToList(
      list: RillValue[],
      input: RillValue,
      defaultValue: ExpressionNode | null,
      location: {
        span?: { start: SourceLocation; end: SourceLocation };
      },
      skipClosureResolution = false
    ): Promise<RillValue> {
      // Validate input is number
      if (typeof input !== 'number') {
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_TYPE_ERROR,
          `List dispatch requires number index, got ${typeof input}`,
          location.span?.start,
          { input, expectedType: 'number' }
        );
      }

      // Truncate decimal to integer
      const index = Math.trunc(input);

      // Normalize negative indices
      const normalizedIndex = index < 0 ? list.length + index : index;

      // Check bounds
      if (normalizedIndex < 0 || normalizedIndex >= list.length) {
        // Check for default value
        if (defaultValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).evaluateExpression(defaultValue);
        }

        // No default - throw error
        throw new RuntimeError(
          RILL_ERROR_CODES.RUNTIME_PROPERTY_NOT_FOUND,
          `List dispatch: index '${index}' not found`,
          location.span?.start,
          { index, listLength: list.length }
        );
      }

      // Return element at normalized index
      const element = list[normalizedIndex]!;
      // Skip closure resolution for hierarchical dispatch (caller handles it)
      if (skipClosureResolution) {
        return element;
      }
      // Auto-invoke closures if needed
      return this.resolveDispatchValueRuntime(element, input, location);
    }

    /**
     * Resolve dispatch value for runtime values: auto-invoke if closure.
     * Similar to resolveDispatchValue but works with runtime values.
     */
    private async resolveDispatchValueRuntime(
      value: RillValue,
      input: RillValue,
      location: {
        span?: { start: SourceLocation; end: SourceLocation };
      }
    ): Promise<RillValue> {
      if (isCallable(value)) {
        // Check if callable has params to determine invocation style
        const hasParams =
          (value.kind === 'script' && value.params.length > 0) ||
          (value.kind === 'application' &&
            value.params !== undefined &&
            value.params.length > 0);

        if (hasParams) {
          // Block-closure: invoke with input as argument
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (this as any).invokeCallable(
            value,
            [input],
            location.span?.start
          );
        } else {
          // Zero-param closure: invoke with args = [] and pipeValue = input
          const savedPipeValue = this.ctx.pipeValue;
          this.ctx.pipeValue = input;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (this as any).invokeCallable(
              value,
              [],
              location.span?.start
            );
            return result;
          } finally {
            this.ctx.pipeValue = savedPipeValue;
          }
        }
      }
      return value;
    }

    /**
     * Create a script callable from a closure node.
     * Closures use late binding - variables are resolved in definingScope when invoked.
     *
     * Default parameter values are evaluated immediately in the current context.
     * Property-style callables (zero params) are auto-invoked on dict access.
     */
    protected async createClosure(node: ClosureNode): Promise<ScriptCallable> {
      // Store reference to the defining scope for late-bound variable resolution
      const definingScope = this.ctx;

      const params: CallableParam[] = [];
      for (const param of node.params) {
        let defaultValue: RillValue | null = null;
        if (param.defaultValue) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          defaultValue = await (this as any).evaluatePrimary(
            param.defaultValue
          );
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

    /**
     * Create a script callable from a block node in expression position.
     * Block-closures have a single implicit $ parameter representing the piped value.
     *
     * No default parameter evaluation since the implicit $ has no default.
     * isProperty is always false (block-closures require $).
     */
    protected createBlockClosure(node: BlockNode): ScriptCallable {
      // Store reference to the defining scope for late-bound variable resolution
      const definingScope = this.ctx;

      // Block-closures have exactly one parameter: $
      const params: CallableParam[] = [
        {
          name: '$',
          typeName: null,
          defaultValue: null,
        },
      ];

      return {
        __type: 'callable',
        kind: 'script',
        params,
        body: node,
        definingScope,
        isProperty: false,
      };
    }

    /**
     * Helper: Check if expression is a bare closure (no pipes, no methods).
     * Used to detect dict entries that should be treated as closures.
     */
    private isClosureExpr(expr: ExpressionNode): boolean {
      if (expr.type !== 'PipeChain') return false;
      const chain = expr as PipeChainNode;
      if (chain.pipes.length > 0) return false;
      if (chain.head.type !== 'PostfixExpr') return false;
      const head = chain.head as PostfixExprNode;
      if (head.methods.length > 0) return false;
      return head.primary.type === 'Closure';
    }

    /**
     * Helper: Check if expression is a bare block (no pipes, no methods).
     * Used to detect dict entries that should be treated as block closures.
     */
    private isBlockExpr(expr: ExpressionNode): boolean {
      if (expr.type !== 'PipeChain') return false;
      const chain = expr as PipeChainNode;
      if (chain.pipes.length > 0) return false;
      if (chain.head.type !== 'PostfixExpr') return false;
      const head = chain.head as PostfixExprNode;
      if (head.methods.length > 0) return false;
      return head.primary.type === 'Block';
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LiteralsMixin = createLiteralsMixin as any;
