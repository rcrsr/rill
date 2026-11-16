/**
 * Use Expression Evaluation
 *
 * Handles `use<scheme:resource>` expressions:
 * - Resolves identifiers (static, variable, computed) to scheme + resource
 * - Looks up registered resolvers from ctx.resolvers
 * - Detects circular resolution via ctx.resolvingSchemes
 * - Executes 'source' results in a child scope
 * - Returns 'value' results directly
 *
 * Interface requirements:
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
import { RillError } from '../../../../types.js';
import {
  fillHostShape,
  RuntimeHaltSignal,
  throwCatchableHostHalt,
  throwFatalHostHalt,
} from '../../types/halt.js';
import type { TypeHaltSite } from '../../types/halt.js';
import type { RillValue } from '../../types/structures.js';
import { createChildContext } from '../../context.js';
import { execute } from '../../execute.js';
import type { EvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation } from '../shared.js';
import { evaluateExpression } from './core.js';
import { evaluateVariableAsync } from './variables.js';
import { validateHostResult } from '../../callable.js';
import { isObjectRecord } from '../../types/guards.js';
import { ControlSignal } from '../../signals.js';
import { brandExtensionValue } from '../../policy/identity.js';

/**
 * Evaluate a use<> expression.
 *
 * Resolves the identifier to a scheme + resource string, calls the
 * registered resolver, and returns the result value (or executes source).
 */
export async function evaluateUseExpr(
  s: EvalState,
  node: UseExprNode
): Promise<RillValue> {
  let scheme: string;
  let resource: string;

  const { identifier } = node;
  const site: TypeHaltSite = {
    location: getNodeLocation(s, node),
    sourceId: s.ctx.sourceId,
    fn: 'evaluateUseExpr',
  };

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
    const varValue = await evaluateVariableAsync(s, varNode);
    if (typeof varValue !== 'string') {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R057],
        `use<> identifier must resolve to string, got ${typeof varValue}`
      );
    }
    const parsed = parseSchemeString(varValue, site);
    scheme = parsed.scheme;
    resource = parsed.resource;
  } else {
    // Computed form: evaluate the expression, expect string
    const exprValue = await evaluateExpression(s, identifier.expression);
    if (typeof exprValue !== 'string') {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R057],
        `use<> identifier must resolve to string, got ${typeof exprValue}`
      );
    }
    const parsed = parseSchemeString(exprValue, site);
    scheme = parsed.scheme;
    resource = parsed.resource;
  }

  // Look up resolver
  const resolver = s.ctx.resolvers.get(scheme);
  if (!resolver) {
    throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R054],
      `No resolver registered for scheme '${scheme}'`
    );
  }

  // Cycle detection: check before calling resolver
  const key = `${scheme}:${resource}`;
  if (s.ctx.resolvingSchemes.has(key)) {
    throwFatalHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R055],
      `Circular resolution detected: ${key} is already being resolved`
    );
  }

  // Mark in-flight — must stay set through source execution so circular
  // re-entry within the executed source is detected (RILL-R055).
  s.ctx.resolvingSchemes.add(key);

  let result;
  try {
    const config = s.ctx.resolverConfigs.get(scheme);
    try {
      result = await resolver(resource, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R056],
        `Resolver error for '${key}': ${message}`
      );
    }

    // Validate resolver result shape — a resolver that resolves successfully
    // but returns a malformed object must halt the same way a throwing
    // resolver does, so no undefined/unshaped value leaks into the runtime.
    if (!isObjectRecord(result)) {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R056],
        `Resolver error for '${key}': resolver result must be an object, got ${result === null ? 'null' : typeof result}`
      );
    }
    const kind = result['kind'];
    if (kind !== 'value' && kind !== 'source') {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R056],
        `Resolver error for '${key}': resolver result must have kind 'value' or 'source', got ${JSON.stringify(kind)}`
      );
    }
    if (kind === 'value' && result['value'] === undefined) {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R056],
        `Resolver error for '${key}': resolver result with kind 'value' is missing a 'value' field`
      );
    }
    if (kind === 'value') {
      // Deep-validate: a raw function, symbol, or bigint nested inside a
      // dict or list would otherwise reach script scope unchecked.
      try {
        validateHostResult(result['value'], key, site.location);
      } catch (err) {
        if (err instanceof ControlSignal) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        throwCatchableHostHalt(
          site,
          ERROR_ATOMS[ERROR_IDS.RILL_R056],
          `Resolver error for '${key}': resolver result value is not a rill value (${detail})`
        );
      }
    }
    if (kind === 'source' && typeof result['text'] !== 'string') {
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R056],
        `Resolver error for '${key}': resolver result with kind 'source' is missing a string 'text' field`
      );
    }

    // Handle result — key is still in-flight for the source execution path
    if (result.kind === 'value') {
      // Record where these callables came from, keyed on the resource in
      // `use<scheme:resource>` rather than on the capture variable the
      // script picks. Policy matches on this brand, so renaming the
      // variable cannot move a method out from under its rule.
      brandExtensionValue(result.value, resource, site);
      return result.value;
    }

    // source: parse and execute in child scope
    const parseSource = s.ctx.parseSource;
    if (!parseSource) {
      throwCatchableHostHalt(
        site,
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
      const parseLocation = err instanceof RillError ? err.location : undefined;
      const detail = err instanceof RillError ? err.rawMessage : message;
      // preserveHostShape carries the parse location, module key, and the
      // original parse error so hosts still see a RILL-R056 error with
      // `.cause` intact.
      throwCatchableHostHalt(
        {
          location: parseLocation ?? node.span.start,
          sourceId: key,
          fn: site.fn,
          preserveHostShape: true,
          hostShape: {
            sourceId: key,
            contextExtras: { sourceId: key },
            cause: err,
          },
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R056],
        `Resolver error for '${key}': ${detail}`
      );
    }
    const childCtx = createChildContext(s.ctx, {
      sourceId: result.sourceId ?? key,
      sourceText: result.text,
    });
    let execResult;
    try {
      execResult = await execute(scriptNode, childCtx);
    } catch (err) {
      // Enrich runtime errors from module execution with sourceId and sourceText
      if (
        err instanceof RillError &&
        (err.sourceId === undefined || err.sourceId === '')
      ) {
        Object.defineProperty(err, 'sourceId', {
          value: result.sourceId ?? key,
        });
        const ctx = err.context ?? {};
        ctx['sourceText'] = result.text;
        Object.defineProperty(err, 'context', { value: ctx });
      }
      // A halt escaping the module is fatal at the module boundary: a guard
      // in the calling script cannot recover a failure the module did not
      // handle itself. Guards inside the module already had their chance.
      if (err instanceof RuntimeHaltSignal) {
        throw new RuntimeHaltSignal(
          fillHostShape(err.value, {
            sourceId: result.sourceId ?? key,
            contextExtras: { sourceText: result.text },
          }),
          false
        );
      }
      throw err;
    }
    return execResult.result;
  } finally {
    // Remove after resolver call and any source execution complete (or error)
    s.ctx.resolvingSchemes.delete(key);
  }
}

/**
 * Parse a "scheme:resource" string, throwing RILL_R058 if ':' is absent.
 * @internal
 */
function parseSchemeString(
  value: string,
  site: TypeHaltSite
): { scheme: string; resource: string } {
  const colonIndex = value.indexOf(':');
  if (colonIndex === -1) {
    throwCatchableHostHalt(
      { ...site, fn: 'parseSchemeString' },
      ERROR_ATOMS[ERROR_IDS.RILL_R058],
      `use<> identifier must contain ':' scheme separator`
    );
  }
  return {
    scheme: value.slice(0, colonIndex),
    resource: value.slice(colonIndex + 1),
  };
}
