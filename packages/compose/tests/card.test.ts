import { describe, it, expect } from 'vitest';
import { generateAgentCard } from '../src/card.js';
import type { AgentManifest } from '../src/schema.js';
import type { ResolvedExtension } from '../src/resolve.js';
import type { ExtensionResult } from '@rcrsr/rill';

// ============================================================
// HELPERS
// ============================================================

const BASE_MANIFEST: AgentManifest = {
  name: 'test-agent',
  version: '1.0.0',
  runtime: '@rcrsr/rill@^0.8.0',
  entry: 'src/main.rill',
  modules: {},
  extensions: {},
  functions: {},
  assets: [],
};

function makeHostFn(): { params: readonly never[]; fn: () => null } {
  return { params: [], fn: () => null };
}

function makeExtension(
  namespace: string,
  fnNames: string[],
  config: Record<string, unknown> = {}
): ResolvedExtension {
  const instance: ExtensionResult = Object.fromEntries(
    fnNames.map((name) => [name, makeHostFn()])
  );

  return {
    alias: namespace,
    namespace,
    strategy: 'npm',
    factory: () => instance,
    config,
  };
}

function makeExtensionWithDispose(
  namespace: string,
  fnNames: string[]
): ResolvedExtension {
  const instance: ExtensionResult = {
    ...Object.fromEntries(fnNames.map((name) => [name, makeHostFn()])),
    dispose: () => undefined,
  };

  return {
    alias: namespace,
    namespace,
    strategy: 'npm',
    factory: () => instance,
    config: {},
  };
}

// ============================================================
// GENERATE AGENT CARD
// ============================================================

describe('generateAgentCard', () => {
  // ============================================================
  // BASIC FIELDS
  // ============================================================

  describe('basic manifest fields', () => {
    it('copies name from manifest', () => {
      const card = generateAgentCard(BASE_MANIFEST, []);
      expect(card.name).toBe('test-agent');
    });

    it('copies version from manifest', () => {
      const card = generateAgentCard(BASE_MANIFEST, []);
      expect(card.version).toBe('1.0.0');
    });
  });

  // ============================================================
  // CAPABILITIES [AC-5]
  // ============================================================

  describe('capabilities [AC-5]', () => {
    it('populates capabilities with correct namespace and function names', () => {
      const ext = makeExtension('llm', ['message', 'embed']);
      const card = generateAgentCard(BASE_MANIFEST, [ext]);

      expect(card.capabilities).toHaveLength(1);
      expect(card.capabilities[0]?.namespace).toBe('llm');
      expect(card.capabilities[0]?.functions).toEqual(['message', 'embed']);
    });

    it('populates capabilities from multiple extensions', () => {
      const llm = makeExtension('llm', ['message', 'embed']);
      const fs = makeExtension('fs', ['read', 'write', 'list']);
      const card = generateAgentCard(BASE_MANIFEST, [llm, fs]);

      expect(card.capabilities).toHaveLength(2);
      expect(card.capabilities[0]?.namespace).toBe('llm');
      expect(card.capabilities[1]?.namespace).toBe('fs');
      expect(card.capabilities[1]?.functions).toEqual([
        'read',
        'write',
        'list',
      ]);
    });

    it('passes config to factory when building capabilities', () => {
      let capturedConfig: Record<string, unknown> | undefined;
      const config = { model: 'gpt-4', temperature: 0.7 };

      const ext: ResolvedExtension = {
        alias: 'llm',
        namespace: 'llm',
        strategy: 'npm',
        factory: (cfg) => {
          capturedConfig = cfg as Record<string, unknown>;
          return { message: makeHostFn() };
        },
        config,
      };

      generateAgentCard(BASE_MANIFEST, [ext]);
      expect(capturedConfig).toEqual(config);
    });

    it('returns empty capabilities array when no extensions provided', () => {
      const card = generateAgentCard(BASE_MANIFEST, []);
      expect(card.capabilities).toEqual([]);
    });
  });

  // ============================================================
  // DISPOSE EXCLUSION
  // ============================================================

  describe('dispose exclusion', () => {
    it('excludes dispose from function names', () => {
      const ext = makeExtensionWithDispose('kv', ['get', 'set', 'delete']);
      const card = generateAgentCard(BASE_MANIFEST, [ext]);

      expect(card.capabilities[0]?.functions).toEqual(['get', 'set', 'delete']);
      expect(card.capabilities[0]?.functions).not.toContain('dispose');
    });

    it('includes all non-dispose functions when dispose is present', () => {
      const ext = makeExtensionWithDispose('kv', ['get', 'set']);
      const card = generateAgentCard(BASE_MANIFEST, [ext]);

      expect(card.capabilities[0]?.functions).toHaveLength(2);
    });
  });

  // ============================================================
  // DEPLOY FIELDS [AC-30, BC-8]
  // ============================================================

  describe('deploy fields [AC-30, BC-8]', () => {
    it('omits port and healthPath when deploy is undefined [AC-30, BC-8]', () => {
      const card = generateAgentCard(BASE_MANIFEST, []);

      expect(card.port).toBeUndefined();
      expect(card.healthPath).toBeUndefined();
    });

    it('does not include port as own property when deploy is undefined [BC-8]', () => {
      const card = generateAgentCard(BASE_MANIFEST, []);

      expect(Object.prototype.hasOwnProperty.call(card, 'port')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(card, 'healthPath')).toBe(
        false
      );
    });

    it('includes port when deploy is defined', () => {
      const manifest: AgentManifest = {
        ...BASE_MANIFEST,
        deploy: { port: 8080, healthPath: '/health' },
      };
      const card = generateAgentCard(manifest, []);

      expect(card.port).toBe(8080);
    });

    it('includes healthPath when deploy is defined', () => {
      const manifest: AgentManifest = {
        ...BASE_MANIFEST,
        deploy: { port: 3000, healthPath: '/ping' },
      };
      const card = generateAgentCard(manifest, []);

      expect(card.healthPath).toBe('/ping');
    });

    it('uses deploy port and healthPath values from manifest', () => {
      const manifest: AgentManifest = {
        ...BASE_MANIFEST,
        deploy: { port: 9090, healthPath: '/status' },
      };
      const card = generateAgentCard(manifest, []);

      expect(card.port).toBe(9090);
      expect(card.healthPath).toBe('/status');
    });
  });

  // ============================================================
  // PURE FUNCTION VERIFICATION
  // ============================================================

  describe('purity', () => {
    it('does not mutate the extensions array', () => {
      const ext = makeExtension('llm', ['message']);
      const extensions = [ext];
      generateAgentCard(BASE_MANIFEST, extensions);

      expect(extensions).toHaveLength(1);
    });

    it('returns consistent results for the same inputs', () => {
      const ext = makeExtension('llm', ['message', 'embed']);
      const card1 = generateAgentCard(BASE_MANIFEST, [ext]);
      const card2 = generateAgentCard(BASE_MANIFEST, [ext]);

      expect(card1.capabilities[0]?.functions).toEqual(
        card2.capabilities[0]?.functions
      );
    });
  });
});
