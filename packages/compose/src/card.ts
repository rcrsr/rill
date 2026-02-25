import type { AgentManifest } from './schema.js';

// ============================================================
// AGENT CARD TYPES
// ============================================================

/**
 * A single skill advertised by an agent in its A2A card.
 */
export interface AgentSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[] | undefined;
  readonly examples?: readonly string[] | undefined;
  readonly inputModes?: readonly string[] | undefined;
  readonly outputModes?: readonly string[] | undefined;
}

/**
 * Transport capabilities declared by an agent.
 */
export interface AgentCapabilities {
  readonly streaming: boolean;
  readonly pushNotifications: boolean;
}

/**
 * A2A-compliant agent card describing identity, capabilities, and skills.
 */
export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly url: string;
  readonly capabilities: AgentCapabilities;
  readonly skills: readonly AgentSkill[];
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
}

// ============================================================
// GENERATE AGENT CARD
// ============================================================

/**
 * Produces an A2A-compliant AgentCard from a validated manifest.
 *
 * Pure function — no I/O, no side effects, does not throw for any valid
 * AgentManifest. Call validateManifest() before calling this function.
 *
 * @param manifest - Validated agent manifest
 * @returns A2A-compliant AgentCard
 */
export function generateAgentCard(manifest: AgentManifest): AgentCard {
  const url =
    manifest.deploy?.port !== undefined
      ? `http://localhost:${manifest.deploy.port}`
      : '';

  return {
    name: manifest.name,
    description: (manifest as { description?: string }).description ?? '',
    version: manifest.version,
    url,
    capabilities: { streaming: false, pushNotifications: false },
    skills: (manifest as { skills?: readonly AgentSkill[] }).skills ?? [],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
  };
}
