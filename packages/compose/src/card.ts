import type { AgentManifest } from './schema.js';
import type { ResolvedExtension } from './resolve.js';

// ============================================================
// AGENT CARD TYPES
// ============================================================

/**
 * A single namespace exposed by a wired extension.
 */
export interface AgentCapability {
  readonly namespace: string;
  readonly functions: readonly string[];
}

/**
 * Declarative description of what an agent exposes.
 * Used for tooling, documentation, and health checks.
 */
export interface AgentCard {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly AgentCapability[];
  readonly port?: number | undefined;
  readonly healthPath?: string | undefined;
}

// ============================================================
// GENERATE AGENT CARD
// ============================================================

/**
 * Builds an AgentCard from a validated manifest and resolved extensions.
 *
 * For each extension, the factory is called with its config. The returned
 * object's own enumerable keys — excluding `dispose` and non-function values
 * — become the function names for that capability.
 *
 * Port and healthPath are included only when `manifest.deploy` is defined.
 *
 * @param manifest - Validated agent manifest
 * @param extensions - Extensions resolved by resolveExtensions()
 * @returns Populated AgentCard (pure, no side effects)
 */
export function generateAgentCard(
  manifest: AgentManifest,
  extensions: ResolvedExtension[]
): AgentCard {
  const capabilities: AgentCapability[] = extensions.map((ext) => {
    const instance = ext.factory(ext.config);

    const functions = Object.keys(instance).filter((key) => key !== 'dispose');

    return { namespace: ext.namespace, functions };
  });

  const card: AgentCard = {
    name: manifest.name,
    version: manifest.version,
    capabilities,
  };

  if (manifest.deploy !== undefined) {
    return {
      ...card,
      port: manifest.deploy.port,
      healthPath: manifest.deploy.healthPath,
    };
  }

  return card;
}
