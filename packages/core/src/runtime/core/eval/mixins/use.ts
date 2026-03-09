/**
 * UseMixin: Use Expression Evaluation
 *
 * Handles `use<scheme:resource>` expressions:
 * - Resolves identifiers (static, variable, computed) to scheme + resource
 * - Looks up registered resolvers from ctx.resolvers
 * - Detects circular resolution via ctx.resolvingSchemes
 * - Executes 'source' results in a child scope
 * - Returns 'value' results directly
 *
 * Interface requirements (from spec IR-6):
 * - evaluateUseExpr(node) -> Promise<RillValue>
 *
 * Error Contracts:
 * - RILL-R054: Scheme not registered in resolvers
 * - RILL-R055: Circular resolution detected
 * - RILL-R056: Resolver callback throws
 * - RILL-R057: Variable/computed form produces non-string
 * - RILL-R058: Resolved string missing ':' separator
 * - RILL-R061: parseSource not configured when resolver returns source
 *
 * @internal
 */

import type { UseExprNode } from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../values.js';
import { createChildContext } from '../../context.js';
import { execute } from '../../execute.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

/**
 * UseMixin implementation.
 *
 * Provides use<> expression evaluation. Resolves scheme-qualified identifiers
 * via the host-provided resolver map on RuntimeContext.
 *
 * Depends on:
 * - EvaluatorBase: ctx, getNodeLocation()
 * - context utilities: createChildContext
 * - execute.ts: execute() for source results
 * - CoreMixin: evaluateExpression() for computed identifiers
 * - VariablesMixin: evaluateVariableAsync() for variable identifiers
 *
 * Methods added:
 * - evaluateUseExpr(node) -> Promise<RillValue>
 */
function createUseMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class UseEvaluator extends Base {
    /**
     * Evaluate a use<> expression [IR-6].
     *
     * Resolves the identifier to a scheme + resource string, calls the
     * registered resolver, and returns the result value (or executes source).
     */
    async evaluateUseExpr(node: UseExprNode): Promise<RillValue> {
      let scheme: string;
      let resource: string;

      const { identifier } = node;

      if (identifier.kind === 'static') {
        // Static form: scheme and segments known at parse time
        scheme = identifier.scheme;
        resource = identifier.segments.join('.');
      } else if (identifier.kind === 'variable') {
        // Variable form: evaluate the variable, expect string
        const varNode = {
          type: 'Variable' as const,
          name: identifier.name,
          isPipeVar: false,
          accessChain: [],
          defaultValue: null,
          span: node.span,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const varValue = await (this as any).evaluateVariableAsync(varNode);
        if (typeof varValue !== 'string') {
          throw RuntimeError.fromNode(
            'RILL-R057',
            `use<> identifier must resolve to string, got ${typeof varValue}`,
            node
          );
        }
        const parsed = parseSchemeString(varValue, node);
        scheme = parsed.scheme;
        resource = parsed.resource;
      } else {
        // Computed form: evaluate the expression, expect string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exprValue = await (this as any).evaluateExpression(
          identifier.expression
        );
        if (typeof exprValue !== 'string') {
          throw RuntimeError.fromNode(
            'RILL-R057',
            `use<> identifier must resolve to string, got ${typeof exprValue}`,
            node
          );
        }
        const parsed = parseSchemeString(exprValue, node);
        scheme = parsed.scheme;
        resource = parsed.resource;
      }

      // Look up resolver
      const resolver = this.ctx.resolvers.get(scheme);
      if (!resolver) {
        throw RuntimeError.fromNode(
          'RILL-R054',
          `No resolver registered for scheme '${scheme}'`,
          node
        );
      }

      // Cycle detection: check before calling resolver
      const key = `${scheme}:${resource}`;
      if (this.ctx.resolvingSchemes.has(key)) {
        throw RuntimeError.fromNode(
          'RILL-R055',
          `Circular resolution detected: ${key} is already being resolved`,
          node
        );
      }

      // Mark in-flight — must stay set through source execution so circular
      // re-entry within the executed source is detected (EC-7 / RILL-R055).
      this.ctx.resolvingSchemes.add(key);

      let result;
      try {
        const config = this.ctx.resolverConfigs.get(scheme);
        try {
          result = await resolver(resource, config);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw RuntimeError.fromNode(
            'RILL-R056',
            `Resolver error for '${key}': ${message}`,
            node
          );
        }

        // Handle result — key is still in-flight for the source execution path
        if (result.kind === 'value') {
          return result.value;
        }

        // source: parse and execute in child scope
        const parseSource = this.ctx.parseSource;
        if (!parseSource) {
          throw RuntimeError.fromNode(
            'RILL-R061',
            `Resolver error for '${key}': parseSource is not configured on RuntimeContext — provide parseSource in RuntimeOptions to use source resolvers`,
            node
          );
        }

        const scriptNode = parseSource(result.text);
        const childCtx = createChildContext(this.ctx);
        const execResult = await execute(scriptNode, childCtx);
        return execResult.result;
      } finally {
        // Remove after resolver call and any source execution complete (or error)
        this.ctx.resolvingSchemes.delete(key);
      }
    }
  };
}

/**
 * Parse a "scheme:resource" string, throwing RILL-R058 if ':' is absent.
 * @internal
 */
function parseSchemeString(
  value: string,
  node: UseExprNode
): { scheme: string; resource: string } {
  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) {
    throw RuntimeError.fromNode(
      'RILL-R058',
      `use<> identifier must contain ':' scheme separator`,
      node
    );
  }
  return {
    scheme: value.slice(0, colonIndex),
    resource: value.slice(colonIndex + 1),
  };
}

// Export with type assertion to work around TS4094 limitation
// TypeScript can't generate declarations for functions returning classes with protected members
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const UseMixin = createUseMixin as any;
