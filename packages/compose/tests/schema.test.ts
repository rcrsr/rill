import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/schema.js';
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
            config: { model: 'gpt-4' },
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
          stateBackend: { type: 'file', config: { dir: '/tmp/state' } },
        },
      });
      expect(result.name).toBe('my-agent');
      expect(result.extensions?.['llm']?.package).toBe('@rcrsr/rill-ext-llm');
      expect(result.host?.timeout).toBe(5000);
      expect(result.deploy?.port).toBe(8080);
    });
  });

  // ============================================================
  // MISSING REQUIRED FIELDS [EC-10, AC-12]
  // ============================================================

  describe('missing required fields [EC-10, AC-12]', () => {
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
  // INVALID SEMVER [EC-12]
  // ============================================================

  describe('invalid semver [EC-12]', () => {
    it('throws ManifestValidationError for non-semver version', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, version: 'not-a-version' })
      ).toThrow(ManifestValidationError);
    });

    it('includes "invalid semver" in the message', () => {
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
  // INVALID RUNTIME FORMAT [EC-13]
  // ============================================================

  describe('invalid runtime format [EC-13]', () => {
    it('throws ManifestValidationError for runtime missing prefix', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, runtime: 'rill@0.8.0' })
      ).toThrow(ManifestValidationError);
    });

    it('includes "expected @rcrsr/rill@{range}" in the message', () => {
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
  // ENV VAR PRESERVATION [IR-2]
  // ============================================================

  describe('${ENV_VAR} preservation [IR-2]', () => {
    it('preserves ${ENV_VAR} placeholders as-is in string fields', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        entry: '${ENTRY_PATH}',
        extensions: {
          llm: { package: '${LLM_PACKAGE}' },
        },
      });
      expect(result.entry).toBe('${ENTRY_PATH}');
      expect(result.extensions?.['llm']?.package).toBe('${LLM_PACKAGE}');
    });

    it('preserves ${ENV_VAR} in name without interpolation', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        name: 'agent-${ENV}',
      });
      expect(result.name).toBe('agent-${ENV}');
    });
  });

  // ============================================================
  // DEFAULT VALUES [IC-16]
  // ============================================================

  describe('default values [IC-16]', () => {
    it('applies default empty object for modules', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.modules).toEqual({});
    });

    it('applies default empty object for extensions', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.extensions).toEqual({});
    });

    it('applies default empty object for functions', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.functions).toEqual({});
    });

    it('applies default empty array for assets', () => {
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

    it('leaves deploy.port undefined when omitted', () => {
      const result = validateManifest({ ...VALID_MANIFEST, deploy: {} });
      expect(result.deploy?.port).toBeUndefined();
    });

    it('applies deploy.healthPath default of /health', () => {
      const result = validateManifest({ ...VALID_MANIFEST, deploy: {} });
      expect(result.deploy?.healthPath).toBe('/health');
    });

    it('applies extension.config default of empty object', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        extensions: { llm: { package: '@rcrsr/rill-ext-llm' } },
      });
      expect(result.extensions?.['llm']?.config).toEqual({});
    });

    it('applies skills default of empty array', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.skills).toEqual([]);
    });
  });

  // ============================================================
  // SKILLS VALIDATION [AC-19, AC-20, AC-21, EC-3, EC-4, EC-5, EC-6]
  // ============================================================

  describe('skills validation [AC-19, AC-20, AC-21, EC-3, EC-4, EC-5, EC-6]', () => {
    it('throws ManifestValidationError for skills:[{}] identifying all 3 missing fields [AC-19]', () => {
      try {
        validateManifest({ ...VALID_MANIFEST, skills: [{}] });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const paths = err.issues.map((i) => i.path);
        expect(paths).toContain('manifest.skills.0.id');
        expect(paths).toContain('manifest.skills.0.name');
        expect(paths).toContain('manifest.skills.0.description');
      }
    });

    it('throws ManifestValidationError for skills missing id [AC-20, EC-3]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          skills: [{ name: 'x', description: 'y' }],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.skills.0.id');
        expect(issue).toBeDefined();
        expect(issue?.message).toBe('manifest.skills.0.id is required');
      }
    });

    it('throws ManifestValidationError for skills missing name [AC-21, EC-4]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          skills: [{ id: 'x', description: 'y' }],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.skills.0.name'
        );
        expect(issue).toBeDefined();
        expect(issue?.message).toBe('manifest.skills.0.name is required');
      }
    });

    it('throws ManifestValidationError for skills missing description [EC-5]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          skills: [{ id: 'x', name: 'y' }],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.skills.0.description'
        );
        expect(issue).toBeDefined();
        expect(issue?.message).toBe(
          'manifest.skills.0.description is required'
        );
      }
    });

    it('throws ManifestValidationError for skills id wrong type [EC-6]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          skills: [{ id: 42, name: 'x', description: 'y' }],
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.skills.0.id');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('expected string');
        expect(issue?.message).toContain('got number');
      }
    });

    it('throws ManifestValidationError for skills:"not-array" [AC-23]', () => {
      expect(() =>
        validateManifest({ ...VALID_MANIFEST, skills: 'not-array' })
      ).toThrow(ManifestValidationError);
    });

    it('accepts a valid skill with all required fields', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        skills: [
          { id: 'search', name: 'Search', description: 'Searches data' },
        ],
      });
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]?.id).toBe('search');
    });
  });

  // ============================================================
  // DESCRIPTION VALIDATION [AC-22, EC-7]
  // ============================================================

  describe('description validation [AC-22, EC-7]', () => {
    it('throws ManifestValidationError for description:42 [AC-22, EC-7]', () => {
      try {
        validateManifest({ ...VALID_MANIFEST, description: 42 });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.description');
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('expected string');
        expect(issue?.message).toContain('got number');
      }
    });

    it('accepts a valid string description', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        description: 'An agent that does things',
      });
      expect(result.description).toBe('An agent that does things');
    });

    it('leaves description undefined when omitted', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.description).toBeUndefined();
    });
  });

  // ============================================================
  // INPUT / OUTPUT SCHEMA VALIDATION [AC-1, AC-10, AC-11, AC-16, AC-20, EC-1..EC-6]
  // ============================================================

  describe('input/output schema validation', () => {
    // AC-1: valid manifest with input and output fields accepted
    it('accepts manifest with input and output fields [AC-1]', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        input: {
          query: {
            type: 'string',
            required: true,
            description: 'Search query',
          },
          limit: { type: 'number', required: false },
        },
        output: { type: 'dict', description: 'Result set' },
      });
      expect(result.input?.['query']?.type).toBe('string');
      expect(result.input?.['limit']?.type).toBe('number');
      expect(result.output?.type).toBe('dict');
    });

    // EC-6: absent input/output returns undefined — no error
    it('returns undefined for input when omitted [EC-6]', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.input).toBeUndefined();
    });

    it('returns undefined for output when omitted [EC-6]', () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.output).toBeUndefined();
    });

    // AC-16: input: {} accepted (empty input valid)
    it('accepts empty input object [AC-16]', () => {
      const result = validateManifest({ ...VALID_MANIFEST, input: {} });
      expect(result.input).toEqual({});
    });

    // EC-1: invalid type name in input descriptor throws ManifestValidationError
    it('throws ManifestValidationError for invalid type in input descriptor [EC-1, AC-10]', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          input: { feedback: { type: 'integer' } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.input.feedback.type for invalid type name [EC-1, AC-10]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          input: { feedback: { type: 'integer' } },
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.input.feedback.type'
        );
        expect(issue).toBeDefined();
      }
    });

    // EC-2: missing type in input descriptor throws ManifestValidationError
    it('throws ManifestValidationError for missing type in input descriptor [EC-2]', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          input: { feedback: { required: true } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.input.feedback.type for missing type [EC-2]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          input: { feedback: { required: true } },
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.input.feedback.type'
        );
        expect(issue).toBeDefined();
      }
    });

    // AC-11 / EC-3: unrecognized field in input descriptor
    it('throws ManifestValidationError for unknown field in input descriptor [AC-11, EC-3]', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          input: { feedback: { type: 'string', badField: true } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.input.feedback.badField for unknown field [AC-11, EC-3]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          input: { feedback: { type: 'string', badField: true } },
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.input.feedback.badField'
        );
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('unknown field');
      }
    });

    // EC-4: invalid type name in output throws ManifestValidationError
    it('throws ManifestValidationError for invalid type name in output [EC-4]', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          output: { type: 'object' },
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.output.type for invalid output type [EC-4]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          output: { type: 'object' },
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find((i) => i.path === 'manifest.output.type');
        expect(issue).toBeDefined();
      }
    });

    // EC-5: unrecognized field in output throws ManifestValidationError
    it('throws ManifestValidationError for unknown field in output [EC-5]', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          output: { type: 'string', badField: 'x' },
        })
      ).toThrow(ManifestValidationError);
    });

    it('includes path manifest.output.badField for unknown output field [EC-5]', () => {
      try {
        validateManifest({
          ...VALID_MANIFEST,
          output: { type: 'string', badField: 'x' },
        });
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestValidationError);
        const err = e as ManifestValidationError;
        const issue = err.issues.find(
          (i) => i.path === 'manifest.output.badField'
        );
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('unknown field');
      }
    });

    // AC-20: recursive output.fields accepted
    it('accepts recursive output.fields [AC-20]', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        output: {
          type: 'dict',
          description: 'Nested result',
          fields: {
            name: { type: 'string' },
            score: {
              type: 'dict',
              fields: {
                value: { type: 'number' },
                label: { type: 'string' },
              },
            },
          },
        },
      });
      expect(result.output?.type).toBe('dict');
      expect(result.output?.fields?.['name']?.type).toBe('string');
      expect(result.output?.fields?.['score']?.fields?.['value']?.type).toBe(
        'number'
      );
    });

    // All five valid types accepted in input descriptor
    it('accepts all valid type values in input descriptor', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        input: {
          a: { type: 'string' },
          b: { type: 'number' },
          c: { type: 'bool' },
          d: { type: 'list' },
          e: { type: 'dict' },
        },
      });
      expect(result.input?.['a']?.type).toBe('string');
      expect(result.input?.['b']?.type).toBe('number');
      expect(result.input?.['c']?.type).toBe('bool');
      expect(result.input?.['d']?.type).toBe('list');
      expect(result.input?.['e']?.type).toBe('dict');
    });

    // default field accepted in input descriptor
    it('accepts default field in input descriptor', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        input: {
          limit: { type: 'number', default: 10 },
        },
      });
      expect(result.input?.['limit']?.default).toBe(10);
    });

    // null default accepted in input descriptor
    it('accepts null default in input descriptor', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        input: {
          token: { type: 'string', default: null },
        },
      });
      expect(result.input?.['token']?.default).toBeNull();
    });
  });

  // ============================================================
  // STATE BACKEND VALIDATION [IR-16]
  // ============================================================

  describe('stateBackend validation [IR-16]', () => {
    it('accepts object form with type "file" and config', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        deploy: { stateBackend: { type: 'file', config: { dir: '/data' } } },
      });
      expect(result.deploy?.stateBackend).toEqual({
        type: 'file',
        config: { dir: '/data' },
      });
    });

    it('accepts object form with type "sqlite" and config', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        deploy: {
          stateBackend: {
            type: 'sqlite',
            config: { path: '/db/state.sqlite' },
          },
        },
      });
      expect(result.deploy?.stateBackend?.type).toBe('sqlite');
    });

    it('accepts object form with type "redis" and config', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        deploy: {
          stateBackend: {
            type: 'redis',
            config: { url: 'redis://localhost:6379' },
          },
        },
      });
      expect(result.deploy?.stateBackend?.type).toBe('redis');
    });

    it('accepts object form with type "memory" and no config', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        deploy: { stateBackend: { type: 'memory' } },
      });
      expect(result.deploy?.stateBackend).toEqual({ type: 'memory' });
    });

    it('accepts legacy string "memory" and coerces to object form', () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        deploy: { stateBackend: 'memory' },
      });
      expect(result.deploy?.stateBackend).toEqual({ type: 'memory' });
    });

    it('rejects object form with type "file" when config is missing', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          deploy: { stateBackend: { type: 'file' } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('rejects object form with type "sqlite" when config is missing', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          deploy: { stateBackend: { type: 'sqlite' } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('rejects object form with type "redis" when config is missing', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          deploy: { stateBackend: { type: 'redis' } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('rejects an invalid type string', () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          deploy: { stateBackend: { type: 'dynamo', config: {} } },
        })
      ).toThrow(ManifestValidationError);
    });

    it('leaves stateBackend undefined when deploy.stateBackend is omitted', () => {
      const result = validateManifest({ ...VALID_MANIFEST, deploy: {} });
      expect(result.deploy?.stateBackend).toBeUndefined();
    });
  });
});
