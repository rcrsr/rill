import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  validateHarnessManifest,
  detectManifestType,
} from '../src/schema.js';
import { ManifestValidationError } from '../src/errors.js';

// ============================================================
// HELPERS
// ============================================================

const VALID_MANIFEST = {
  name: 'my-agent',
  version: '1.0.0',
  runtime: '@rcrsr/rill@^0.8.0',
  entry: 'src/main.rill',
};

const VALID_HARNESS_MANIFEST = {
  agents: [
    {
      name: 'agent-one',
      entry: 'src/agent-one.rill',
    },
  ],
};

// ============================================================
// VALID MANIFESTS
// ============================================================

describe('validateManifest', () => {
  describe('valid manifests [AC-11, AC-12]', () => {
    it('accepts a manifest with all required fields', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.name).toBe('my-agent');
      expect(result.version).toBe('1.0.0');
      expect(result.runtime).toBe('@rcrsr/rill@^0.8.0');
      expect(result.entry).toBe('src/main.rill');
    });

    it('accepts a full manifest with all optional fields', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        modules: { utils: './utils.rill' },
        extensions: {
          llm: {
            package: '@rcrsr/rill-ext-llm',
            version: '1.0.0',
          },
        },
        functions: { greet: 'host.greet' },
        assets: ['images/logo.png'],
        host: {
          timeout: 5000,
          maxCallStackDepth: 50,
          requireDescriptions: true,
        },
        deploy: {
          port: 8080,
          healthPath: '/ping',
        },
      });
      expect(result.name).toBe('my-agent');
      expect(result.extensions?.['llm']?.package).toBe('@rcrsr/rill-ext-llm');
      expect(result.host?.timeout).toBe(5000);
      expect(result.deploy?.port).toBe(8080);
    });
  });

  // ============================================================
  // INVALID JSON SCHEMA [EC-1]
  // ============================================================

  describe('invalid JSON schema [EC-1]', () => {
    it('throws ManifestValidationError when input is null', () => {
      expect(() => validateManifest(null)).toThrow(ManifestValidationError);
    });

    it('includes issues[] with at least one issue when input is null', () => {
      try {
        validateManifest(null);
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        expect(Array.isArray(err.issues)).toBe(true);
        expect(err.issues.length).toBeGreaterThan(0);
      }
    });

    it('throws ManifestValidationError when input is a plain number', () => {
      expect(() => validateManifest(42)).toThrow(ManifestValidationError);
    });

    it('throws ManifestValidationError when name is missing', () => {
      const rest = {
        version: VALID_MANIFEST.version,
        runtime: VALID_MANIFEST.runtime,
        entry: VALID_MANIFEST.entry,
      };
      expect(() => validateManifest(rest)).toThrow(ManifestValidationError);
    });

    it('includes path "manifest.name" when name is missing', () => {
      const rest = {
        version: VALID_MANIFEST.version,
        runtime: VALID_MANIFEST.runtime,
        entry: VALID_MANIFEST.entry,
      };
      try {
        validateManifest(rest);
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.name');
        expect(issue).toBeDefined();
        expect(issue?.message).toBe('manifest.name is required');
      }
    });

    it('throws ManifestValidationError when entry is missing', () => {
      const rest = {
        name: VALID_MANIFEST.name,
        version: VALID_MANIFEST.version,
        runtime: VALID_MANIFEST.runtime,
      };
      expect(() => validateManifest(rest)).toThrow(ManifestValidationError);
    });

    it('includes path "manifest.entry" when entry is missing', () => {
      const rest = {
        name: VALID_MANIFEST.name,
        version: VALID_MANIFEST.version,
        runtime: VALID_MANIFEST.runtime,
      };
      try {
        validateManifest(rest);
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.entry');
        expect(issue).toBeDefined();
        expect(issue?.message).toBe('manifest.entry is required');
      }
    });
  });

  // ============================================================
  // WRONG TYPE [EC-11]
  // ============================================================

  describe('wrong type [EC-11]', () => {
    it('throws ManifestValidationError when name is a number', () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, name: 42 })).toThrow(
        ManifestValidationError
      );
    });

    it('includes expected/got info when name is a number', () => {
      try {
        validateManifest({ ...VALID_MANIFEST, name: 42 });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.name');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('expected string');
        expect(issue?.message).toContain('got number');
      }
    });
  });

  // ============================================================
  // INVALID SEMVER [EC-2]
  // ============================================================

  describe('invalid semver [EC-2]', () => {
    it('throws ManifestValidationError for non-semver version', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, version: 'not-a-version' })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.version when version is invalid semver', () => {
      try {
        validateManifest({ ...VALID_MANIFEST, version: 'not-a-version' });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.version');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('invalid semver');
        expect(issue?.message).toContain('not-a-version');
      }
    });

    it('accepts valid semver with pre-release tag', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        version: '2.0.0-alpha.1',
      });
      expect(result.version).toBe('2.0.0-alpha.1');
    });

    it('accepts valid semver with build metadata', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        version: '1.0.0+build.42',
      });
      expect(result.version).toBe('1.0.0+build.42');
    });
  });

  // ============================================================
  // INVALID RUNTIME FORMAT [EC-3]
  // ============================================================

  describe('invalid runtime format [EC-3]', () => {
    it('throws ManifestValidationError for runtime missing prefix', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, runtime: 'rill@0.8.0' })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.runtime when runtime format is invalid', () => {
      try {
        validateManifest({ ...VALID_MANIFEST, runtime: 'rill@0.8.0' });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.runtime');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('expected @rcrsr/rill@{range}');
      }
    });

    it('throws for runtime with wrong package name', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, runtime: '@other/pkg@1.0.0' })
      ).toThrow(ManifestValidationError);
    });
  });

  // ============================================================
  // UNKNOWN FIELDS [EC-14]
  // ============================================================

  describe('unknown fields in strict mode [EC-14]', () => {
    it('throws ManifestValidationError for unknown top-level field', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, unknownField: 'value' })
      ).toThrow(ManifestValidationError);
    });

    it('includes "unknown field" in the message', () => {
      try {
        validateManifest({ ...VALID_MANIFEST, unknownField: 'value' });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        expect(
          err.issues.some((i) => i.message.includes('unknown field'))
        ).toBe(true);
      }
    });

    it('throws for unknown field inside extensions entry', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          extensions: { llm: { package: '@rcrsr/rill-ext-llm', badKey: true } },
        })
      ).toThrow(ManifestValidationError);
    });
  });

  // ============================================================
  // ZERO-EXTENSION MANIFEST [AC-16]
  // ============================================================

  describe('zero-extension manifest [AC-16]', () => {
    it('validates a manifest with no extensions field without error', () => {
      expect(() => validateManifest(VALID_MANIFEST)).not.toThrow();
    });

    it('returns default empty extensions when extensions is omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.extensions).toEqual({});
    });

    it('applies default empty object for modules when omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.modules).toEqual({});
    });

    it('applies default empty object for functions when omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.functions).toEqual({});
    });

    it('applies default empty array for assets when omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.assets).toEqual([]);
    });

    it('leaves host undefined when omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.host).toBeUndefined();
    });

    it('applies host.maxCallStackDepth default of 100', () => {
      const result = validateManifest({ ...VALID_MANIFEST, host: {} });
      expect(result.host?.maxCallStackDepth).toBe(100);
    });

    it('applies host.requireDescriptions default of false', () => {
      const result = validateManifest({ ...VALID_MANIFEST, host: {} });
      expect(result.host?.requireDescriptions).toBe(false);
    });

    it('leaves deploy undefined when omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.deploy).toBeUndefined();
    });

    it('applies deploy.healthPath default of /health', () => {
      const result = validateManifest({ ...VALID_MANIFEST, deploy: {} });
      expect(result.deploy?.healthPath).toBe('/health');
    });

    it('applies skills default of empty array', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.skills).toEqual([]);
    });
  });

  // ============================================================
  // ENV FIELD REMOVED
  // ============================================================

  describe('env field removed', () => {
    it('rejects manifest with env field as unknown field', () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, env: [] })).toThrow(
        ManifestValidationError
      );
    });
  });
});

// ============================================================
// VALIDATE HARNESS MANIFEST
// ============================================================

describe('validateHarnessManifest', () => {
  // ============================================================
  // SINGLE-AGENT HARNESS [AC-17]
  // ============================================================

  describe('single-agent harness [AC-17]', () => {
    it('validates a single-agent harness manifest without error', () => {
      expect(() =>
        validateHarnessManifest(VALID_HARNESS_MANIFEST)
      ).not.toThrow();
    });

    it('returns the manifest with agents array of length 1', () => {
      const result = validateHarnessManifest(VALID_HARNESS_MANIFEST);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0]?.name).toBe('agent-one');
    });

    it('applies default empty shared extensions', () => {
      const result = validateHarnessManifest(VALID_HARNESS_MANIFEST);
      expect(result.shared).toEqual({});
    });

    it('leaves host undefined when omitted', () => {
      const result = validateHarnessManifest(VALID_HARNESS_MANIFEST);
      expect(result.host).toBeUndefined();
    });
  });

  // ============================================================
  // DUPLICATE AGENT NAME [EC-4]
  // ============================================================

  describe('duplicate agent name [EC-4]', () => {
    it('throws ManifestValidationError for duplicate agent names', () => {
      expect(() =>
        validateHarnessManifest({
          agents: [
            { name: 'agent-one', entry: 'src/a.rill' },
            { name: 'agent-one', entry: 'src/b.rill' },
          ],
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.agents when agent names are duplicated', () => {
      try {
        validateHarnessManifest({
          agents: [
            { name: 'agent-one', entry: 'src/a.rill' },
            { name: 'agent-one', entry: 'src/b.rill' },
          ],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.agents');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('agent-one');
      }
    });

    it('accepts two agents with distinct names', () => {
      expect(() =>
        validateHarnessManifest({
          agents: [
            { name: 'agent-one', entry: 'src/a.rill' },
            { name: 'agent-two', entry: 'src/b.rill' },
          ],
        })
      ).not.toThrow();
    });
  });

  // ============================================================
  // MAXCONCURRENCY OVERFLOW [EC-5]
  // ============================================================

  describe('maxConcurrency overflow [EC-5]', () => {
    it('throws ManifestValidationError when sum of agent maxConcurrency exceeds host cap', () => {
      expect(() =>
        validateHarnessManifest({
          host: { maxConcurrency: 5 },
          agents: [
            { name: 'agent-one', entry: 'src/a.rill', maxConcurrency: 3 },
            { name: 'agent-two', entry: 'src/b.rill', maxConcurrency: 4 },
          ],
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.host.maxConcurrency on overflow', () => {
      try {
        validateHarnessManifest({
          host: { maxConcurrency: 5 },
          agents: [
            { name: 'agent-one', entry: 'src/a.rill', maxConcurrency: 3 },
            { name: 'agent-two', entry: 'src/b.rill', maxConcurrency: 4 },
          ],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.host.maxConcurrency'
        );
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('5');
      }
    });

    it('accepts when sum of agent maxConcurrency equals host cap exactly', () => {
      expect(() =>
        validateHarnessManifest({
          host: { maxConcurrency: 7 },
          agents: [
            { name: 'agent-one', entry: 'src/a.rill', maxConcurrency: 3 },
            { name: 'agent-two', entry: 'src/b.rill', maxConcurrency: 4 },
          ],
        })
      ).not.toThrow();
    });
  });

  // ============================================================
  // NAMESPACE COLLISION [EC-6]
  // ============================================================

  describe('namespace collision [EC-6]', () => {
    it('throws ManifestValidationError for namespace collision between shared and per-agent extensions', () => {
      expect(() =>
        validateHarnessManifest({
          shared: {
            llm: { package: '@rcrsr/rill-ext-llm' },
          },
          agents: [
            {
              name: 'agent-one',
              entry: 'src/a.rill',
              extensions: {
                llm: { package: '@rcrsr/rill-ext-llm' },
              },
            },
          ],
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.agents.<name>.extensions.<ns> on namespace collision', () => {
      try {
        validateHarnessManifest({
          shared: {
            llm: { package: '@rcrsr/rill-ext-llm' },
          },
          agents: [
            {
              name: 'agent-one',
              entry: 'src/a.rill',
              extensions: {
                llm: { package: '@rcrsr/rill-ext-llm' },
              },
            },
          ],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.agents.agent-one.extensions.llm'
        );
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('llm');
      }
    });

    it('accepts agents with distinct extension namespaces', () => {
      expect(() =>
        validateHarnessManifest({
          shared: {
            llm: { package: '@rcrsr/rill-ext-llm' },
          },
          agents: [
            {
              name: 'agent-one',
              entry: 'src/a.rill',
              extensions: {
                db: { package: '@rcrsr/rill-ext-db' },
              },
            },
          ],
        })
      ).not.toThrow();
    });
  });

  // ============================================================
  // EMPTY AGENTS ARRAY
  // ============================================================

  describe('empty agents array', () => {
    it('throws ManifestValidationError when agents is empty', () => {
      expect(() => validateHarnessManifest({ agents: [] })).toThrow(
        ManifestValidationError
      );
    });
  });
});

// ============================================================
// DETECT MANIFEST TYPE
// ============================================================

describe('detectManifestType', () => {
  it('returns "harness" when input has agents key', () => {
    expect(detectManifestType({ agents: [] })).toBe('harness');
  });

  it('returns "agent" for a plain agent manifest', () => {
    expect(detectManifestType(VALID_MANIFEST)).toBe('agent');
  });

  it('returns "agent" for null', () => {
    expect(detectManifestType(null)).toBe('agent');
  });

  it('returns "agent" for undefined', () => {
    expect(detectManifestType(undefined)).toBe('agent');
  });

  it('returns "agent" for a number', () => {
    expect(detectManifestType(42)).toBe('agent');
  });

  it('returns "agent" for an object without agents key', () => {
    expect(detectManifestType({ name: 'x' })).toBe('agent');
  });
});
