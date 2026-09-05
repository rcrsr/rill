/**
 * Build a ResolvedPolicy from a PolicyConfig and mounted extensions.
 *
 * Called once at context creation. Resolves transform string references
 * ("filter.sanitize") to actual callables by looking them up in the
 * mounted extension values. Throws if a reference can't be resolved.
 */

import { isCallable } from '../callable.js';
import type { RillCallable } from '../callable.js';
import { isDict } from '../types/guards.js';
import type { RillValue } from '../types/structures.js';
import type {
  Filter,
  MethodPolicyRule,
  PolicyConfig,
  ResolvedPolicy,
} from './types.js';
import { RuntimeError } from '../../../types.js';
import { ERROR_IDS } from '../../../error-registry.js';

/**
 * Resolve a PolicyConfig into a ResolvedPolicy.
 *
 * ## Deny baseline
 *
 * Listing rules for an extension does not close it. A method with no
 * rule of its own passes through unfiltered, so a method added to an
 * extension later reaches the boundary unpoliced until someone writes a
 * rule for it. Hosts that want to fail closed must say so explicitly:
 *
 * ```json
 * { "kb": { "*": { "access": "deny" }, "search": { "access": "allow" } } }
 * ```
 *
 * The `"*"` rule is access-control only. Transforms conform to the
 * signature of the method they wrap, and one signature cannot cover a
 * heterogeneous set of methods; deny needs no signature. A `"*"` rule
 * carrying `in` or `out` is rejected (RILL-R084).
 *
 * ## Scope
 *
 * Policy applies to callables reached through `use<scheme:resource>`,
 * which is where extension identity is branded. Values injected through
 * `RuntimeOptions.variables` or registered as host `functions` carry no
 * extension identity and are not policed.
 *
 * @param config - Raw policy config from the host
 * @param extensions - Map of mounted extension names to their values
 *                     (the RillValue dicts returned by extension factories)
 * @returns Deeply frozen ResolvedPolicy with references replaced by callables
 * @throws RuntimeError RILL-R084 if a wildcard rule declares transforms
 * @throws RuntimeError RILL-R085 if a transform reference can't be resolved
 */
export function resolvePolicy(
  config: PolicyConfig,
  extensions: Map<string, RillValue>
): ResolvedPolicy {
  const rules = new Map<string, ReadonlyMap<string, Filter>>();
  const defaults = new Map<string, Filter>();

  for (const [extName, methodPolicy] of Object.entries(config)) {
    const methodRules = new Map<string, Filter>();

    for (const [methodName, rule] of Object.entries(methodPolicy)) {
      if (methodName === '*') {
        // Validate before resolving: a malformed wildcard should report
        // as a wildcard problem, not as whatever its transforms happen
        // to reference.
        if (hasTransforms(rule)) {
          throw new RuntimeError(
            ERROR_IDS.RILL_R084,
            `Wildcard rule "*" on extension "${extName}" cannot have ` +
              `in/out transforms. Wildcard is access-control only.`,
            undefined,
            { extension: extName }
          );
        }
        defaults.set(
          extName,
          freezeFilter({
            access: rule.access,
            inTransforms: [],
            outTransforms: [],
          })
        );
      } else {
        methodRules.set(methodName, resolveRule(rule, extensions));
      }
    }

    if (methodRules.size > 0) {
      rules.set(extName, freezeMap(methodRules));
    }
  }

  return Object.freeze({
    rules: freezeMap(rules),
    defaults: freezeMap(defaults),
  });
}

/**
 * Whether a rule declares any transform.
 * An empty array declares none — `rule.in || rule.out` would call `[]`
 * present and reject a valid config.
 */
function hasTransforms(rule: MethodPolicyRule): boolean {
  return (rule.in?.length ?? 0) > 0 || (rule.out?.length ?? 0) > 0;
}

/**
 * Resolve a single method policy rule into a Filter.
 */
function resolveRule(
  rule: MethodPolicyRule,
  extensions: Map<string, RillValue>
): Filter {
  return freezeFilter({
    access: rule.access,
    inTransforms: resolveTransforms(rule.in ?? [], extensions),
    outTransforms: resolveTransforms(rule.out ?? [], extensions),
  });
}

/**
 * Resolve an array of transform references to callables.
 *
 * Each reference is "extName.method" format. Looks up the extension
 * dict, then the method on it.
 *
 * @throws RuntimeError (RILL-R085) if the extension or method is not found
 */
function resolveTransforms(
  refs: readonly string[],
  extensions: Map<string, RillValue>
): RillCallable[] {
  return refs.map((ref) => {
    const dotIndex = ref.indexOf('.');
    if (dotIndex === -1) {
      throw invalidReference(ref, 'expected "extension.method" format');
    }

    const extName = ref.slice(0, dotIndex);
    const methodName = ref.slice(dotIndex + 1);

    const extValue = extensions.get(extName);
    if (extValue === undefined) {
      throw invalidReference(
        ref,
        `extension "${extName}" not found in mounted extensions`
      );
    }

    // `typeof extValue === "object"` also admits arrays, tuples, vectors,
    // ordered values, datetimes, durations, streams, and callables — none
    // of which can carry a method. Reject them as the shape problem they
    // are rather than indexing into them and reporting a missing method.
    if (!isDict(extValue)) {
      throw invalidReference(
        ref,
        `extension "${extName}" is not a dict and cannot provide methods`
      );
    }

    // Own properties only: an unquoted "constructor" or "toString" would
    // otherwise reach Object.prototype.
    if (!Object.hasOwn(extValue, methodName)) {
      throw invalidReference(
        ref,
        `method "${methodName}" not found on extension "${extName}"`
      );
    }

    const method = extValue[methodName];
    if (method === undefined || !isCallable(method)) {
      throw invalidReference(
        ref,
        `method "${methodName}" on extension "${extName}" is not callable`
      );
    }

    return method;
  });
}

function invalidReference(ref: string, reason: string): RuntimeError {
  return new RuntimeError(
    ERROR_IDS.RILL_R085,
    `Transform reference "${ref}": ${reason}`,
    undefined,
    { reference: ref, reason }
  );
}

/**
 * Freeze a filter and its transform arrays.
 *
 * `readonly` is compile-time only. Filters reach the dispatch boundary
 * on every call, so an unfrozen one could be rewritten in place by any
 * code that gets a reference to it.
 */
function freezeFilter(filter: {
  access: 'allow' | 'deny';
  inTransforms: RillCallable[];
  outTransforms: RillCallable[];
}): Filter {
  return Object.freeze({
    access: filter.access,
    inTransforms: Object.freeze(filter.inTransforms),
    outTransforms: Object.freeze(filter.outTransforms),
  });
}

/**
 * Seal a Map against mutation.
 *
 * `Object.freeze` does not touch Map internals, so `set`/`delete`/`clear`
 * stay live on a frozen Map. Replacing them with throwing stubs is what
 * actually stops a host function from calling `.clear()` to disarm the
 * policy mid-run.
 */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const reject = (): never => {
    throw new TypeError('ResolvedPolicy is immutable');
  };
  return Object.freeze(
    Object.assign(map, { set: reject, delete: reject, clear: reject })
  );
}
