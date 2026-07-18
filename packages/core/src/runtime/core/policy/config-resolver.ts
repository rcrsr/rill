/**
 * Build a ResolvedPolicy from a PolicyConfig and mounted extensions.
 *
 * Called once at context creation. Resolves transform string references
 * ("filter.sanitize") to actual callables by looking them up in the
 * mounted extension values. Throws if a reference can't be resolved.
 */

import type { RillValue } from '../types/structures.js';
import { isCallable } from '../callable.js';
import type { RillCallable } from '../callable.js';
import type {
  PolicyConfig,
  ResolvedPolicy,
  Filter,
  MethodPolicyRule,
} from './types.js';
import { RuntimeError } from '../../../../types.js';
import { ERROR_IDS } from '../../../../error-registry.js';

/**
 * Resolve a PolicyConfig into a ResolvedPolicy.
 *
 * @param config - Raw policy config from rill-config.json
 * @param extensions - Map of mounted extension names to their values
 *                     (the RillValue dicts returned by extension factories)
 * @returns ResolvedPolicy with transform references replaced by callables
 * @throws RuntimeError if a transform reference can't be resolved
 */
export function resolvePolicy(
  config: PolicyConfig,
  extensions: Map<string, RillValue>
): ResolvedPolicy {
  const rules = new Map<string, Map<string, Filter>>();
  const defaults = new Map<string, Filter>();

  for (const [extName, methodPolicy] of Object.entries(config)) {
    const methodRules = new Map<string, Filter>();

    for (const [methodName, rule] of Object.entries(methodPolicy)) {
      const filter = resolveRule(rule, extensions);

      if (methodName === '*') {
        // Wildcard: access-control only, no transforms
        if (rule.in || rule.out) {
          throw new RuntimeError(
            ERROR_IDS.RILL_R084,
            `Wildcard rule "*" on extension "${extName}" cannot have ` +
              `in/out transforms. Wildcard is access-control only.`
          );
        }
        defaults.set(extName, filter);
      } else {
        methodRules.set(methodName, filter);
      }
    }

    if (methodRules.size > 0) {
      rules.set(extName, methodRules);
    }
  }

  return { rules, defaults };
}

/**
 * Resolve a single method policy rule into a Filter.
 */
function resolveRule(
  rule: MethodPolicyRule,
  extensions: Map<string, RillValue>
): Filter {
  return {
    access: rule.access,
    inTransforms: resolveTransforms(rule.in ?? [], extensions),
    outTransforms: resolveTransforms(rule.out ?? [], extensions),
  };
}

/**
 * Resolve an array of transform references to callables.
 *
 * Each reference is "extName.method" format. Looks up the extension
 * dict, then the method on it.
 *
 * @throws RuntimeError (RILL_R085) if the extension or method is not found
 */
function resolveTransforms(
  refs: string[],
  extensions: Map<string, RillValue>
): RillCallable[] {
  return refs.map((ref) => {
    const dotIndex = ref.indexOf('.');
    if (dotIndex === -1) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R085,
        `Invalid transform reference "${ref}": expected "extension.method" format`
      );
    }

    const extName = ref.slice(0, dotIndex);
    const methodName = ref.slice(dotIndex + 1);

    const extValue = extensions.get(extName);
    if (!extValue || typeof extValue !== 'object') {
      throw new RuntimeError(
        ERROR_IDS.RILL_R085,
        `Transform reference "${ref}": extension "${extName}" not found ` +
          `in mounted extensions`
      );
    }

    const method = (extValue as Record<string, RillValue>)[methodName];
    if (!method || !isCallable(method)) {
      throw new RuntimeError(
        ERROR_IDS.RILL_R085,
        `Transform reference "${ref}": method "${methodName}" not found ` +
          `or not callable on extension "${extName}"`
      );
    }

    return method;
  });
}