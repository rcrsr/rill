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
import { RillError, RuntimeError } from '../../../../types.js';
import { throwCatchableHostHalt } from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';
import { createChildContext } from '../../context.js';
import { execute } from '../../execute.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvaluatorInterface } from '../interface.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';

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
    protected async evaluateUseExpr(node: UseExprNode): Promise<RillValue> {
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
          existenceCheck: null,
          span: node.span,
        };
        const varValue = await (
          this as unknown as EvaluatorInterface
        ).evaluateVariableAsync(varNode);
        if (typeof varValue !== 'string') {
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'evaluateUseExpr',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R057],
            `use<> identifier must resolve to string, got ${typeof varValue}`
          );
        }
        const parsed = parseSchemeString(
          varValue,
          node,
          this.getNodeLocation(node),
          this.ctx.sourceId
        );
        scheme = parsed.scheme;
        resource = parsed.resource;
      } else {
        // Computed form: evaluate the expression, expect string
        const exprValue = await (
          this as unknown as EvaluatorInterface
        ).evaluateExpression(identifier.expression);
        if (typeof exprValue !== 'string') {
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'evaluateUseExpr',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R057],
            `use<> identifier must resolve to string, got ${typeof exprValue}`
          );
        }
        const parsed = parseSchemeString(
          exprValue,
          node,
          this.getNodeLocation(node),
          this.ctx.sourceId
        );
        scheme = parsed.scheme;
        resource = parsed.resource;
      }

      // Look up resolver
      const resolver = this.ctx.resolvers.get(scheme);
      if (!resolver) {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateUseExpr',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R054],
          `No resolver registered for scheme '${scheme}'`
        );
      }

      // Cycle detection: check before calling resolver
      const key = `${scheme}:${resource}`;
      if (this.ctx.resolvingSchemes.has(key)) {
        throwCatchableHostHalt(
          {
            location: this.getNodeLocation(node),
            sourceId: this.ctx.sourceId,
            fn: 'evaluateUseExpr',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R055],
          `Circular resolution detected: ${key} is already being resolved`
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
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'evaluateUseExpr',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R056],
            `Resolver error for '${key}': ${message}`
          );
        }

        // Handle result — key is still in-flight for the source execution path
        if (result.kind === 'value') {
          return result.value;
        }

        // source: parse and execute in child scope
        const parseSource = this.ctx.parseSource;
        if (!parseSource) {
          throwCatchableHostHalt(
            {
              location: this.getNodeLocation(node),
              sourceId: this.ctx.sourceId,
              fn: 'evaluateUseExpr',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R061],
            `Resolver error for '${key}': parseSource is not configured on RuntimeContext — provide parseSource in RuntimeOptions to use source resolvers`
          );
        }

        let scriptNode;
        try {
          scriptNode = parseSource(result.text);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Use the parse error's location within the resolved source, not the use<> call site
          const parseLocation =
            err instanceof RillError ? err.location : undefined;
          // Preserve the JS-standard `.cause` chain so host callers can
          // inspect the original parse error. Halt builders cannot carry
          // a live `cause` through to the bridge (only raw fields), so
          // this single wrap site keeps the RuntimeError construction.
          const wrapped =
            parseLocation !== undefined
              ? new RuntimeError(
                  ERROR_IDS.RILL_R056,
                  `Resolver error for '${key}': ${message.replace(/ at \d+:\d+$/, '')}`,
                  parseLocation,
                  { sourceId: key }
                )
              : RuntimeError.fromNode(
                  ERROR_IDS.RILL_R056,
                  `Resolver error for '${key}': ${message}`,
                  node,
                  { sourceId: key }
                );
          (wrapped as { sourceId: string }).sourceId = key;
          wrapped.cause = err;
          throw wrapped;
        }
        const childCtx = createChildContext(this.ctx, {
          sourceId: result.sourceId ?? key,
          sourceText: result.text,
        });
        let execResult;
        try {
          execResult = await execute(scriptNode, childCtx);
        } catch (err) {
          // Enrich runtime errors from module execution with sourceId and sourceText
          if (err instanceof RillError && !err.sourceId) {
            (err as { sourceId: string }).sourceId = result.sourceId ?? key;
            const ctx = (err.context ?? {}) as Record<string, unknown>;
            ctx['sourceText'] = result.text;
            (err as { context: Record<string, unknown> }).context = ctx;
          }
          throw err;
        }
        return execResult.result;
      } finally {
        // Remove after resolver call and any source execution complete (or error)
        this.ctx.resolvingSchemes.delete(key);
      }
    }
  };
}

/**
 * Parse a "scheme:resource" string, throwing RILL_R058 if ':' is absent.
 * @internal
 */
function parseSchemeString(
  value: string,
  _node: UseExprNode,
  location: ReturnType<EvaluatorBase['getNodeLocation']>,
  sourceId: string | undefined
): { scheme: string; resource: string } {
  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) {
    throwCatchableHostHalt(
      { location, sourceId, fn: 'parseSchemeString' },
      ERROR_ATOMS[ERROR_IDS.RILL_R058],
      `use<> identifier must contain ':' scheme separator`
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

/**
 * Capability fragment: methods contributed by UseMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type UseMixinCapability = {
  evaluateUseExpr(node: UseExprNode): Promise<RillValue>;
};
