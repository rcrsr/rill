import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAhiExtension, type AhiExtensionConfig } from '../src/index.js';

// ============================================================
// EC-1: agents array without registry
// ============================================================

describe('createAhiExtension', () => {
  describe('EC-1: agents array without registry', () => {
    it('throws when agents is an array and registry is absent', () => {
      const config: AhiExtensionConfig = {
        agents: ['parser', 'writer'],
      };

      expect(() => createAhiExtension(config)).toThrow(
        'AHI extension requires registry URL when agents is an array'
      );
    });

    it('throws when agents is an array and registry is empty string', () => {
      const config: AhiExtensionConfig = {
        agents: ['parser'],
        registry: '',
      };

      expect(() => createAhiExtension(config)).toThrow(
        'AHI extension requires registry URL when agents is an array'
      );
    });
  });

  // ============================================================
  // EC-2: unresolved env variable in static URL
  // ============================================================

  describe('EC-2: unresolved env variable throws at init', () => {
    it('throws synchronously when a ${VAR} is unset', () => {
      const config: AhiExtensionConfig = {
        agents: {
          parser: { url: 'http://${MISSING_VAR}/api' },
        },
      };

      expect(() => createAhiExtension(config)).toThrow(
        'AHI: environment variable MISSING_VAR is not set'
      );
    });

    it('throws at init time, not at call time', () => {
      // Verify the throw happens inside the factory, not lazily
      let threw = false;
      try {
        createAhiExtension({
          agents: { svc: { url: '${ALSO_MISSING}' } },
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    it('resolves set env variables without throwing', () => {
      const original = process.env['AHI_TEST_URL'];
      process.env['AHI_TEST_URL'] = 'http://localhost:4001';

      try {
        expect(() =>
          createAhiExtension({
            agents: { svc: { url: 'http://${AHI_TEST_URL}/api' } },
          })
        ).not.toThrow();
      } finally {
        if (original === undefined) {
          delete process.env['AHI_TEST_URL'];
        } else {
          process.env['AHI_TEST_URL'] = original;
        }
      }
    });
  });

  // ============================================================
  // AC-1: agents object registers ahi::<name>
  // ============================================================

  describe('AC-1: agents object registers ahi::<name> host function', () => {
    it('registers ahi::parser for a single agent', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      expect('ahi::parser' in result).toBe(true);
    });

    it('registered function has valid HostFunctionDefinition shape', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      const fn = result['ahi::parser'];
      expect(fn).toBeDefined();
      expect(typeof fn.fn).toBe('function');
      expect(Array.isArray(fn.params)).toBe(true);
    });

    it('registers multiple agents', () => {
      const result = createAhiExtension({
        agents: {
          parser: { url: 'http://localhost:4001' },
          writer: { url: 'http://localhost:4002' },
        },
      });

      expect('ahi::parser' in result).toBe(true);
      expect('ahi::writer' in result).toBe(true);
    });

    it('registered function is async', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      const fn = result['ahi::parser']!;
      // fn returns a Promise (async function)
      const returnValue = fn.fn([], {} as never, undefined);
      expect(returnValue).toBeInstanceOf(Promise);
      // Reject the dangling promise to avoid unhandled rejection noise
      void returnValue.catch(() => undefined);
    });

    it('includes dispose method', () => {
      const result = createAhiExtension({
        agents: { parser: { url: 'http://localhost:4001' } },
      });

      expect(typeof result.dispose).toBe('function');
    });
  });

  // ============================================================
  // AC-20: empty agents object
  // ============================================================

  describe('AC-20: empty agents object registers nothing', () => {
    it('returns empty result with no ahi:: functions', () => {
      const result = createAhiExtension({ agents: {} });

      const functionKeys = Object.keys(result).filter(
        (k) => k !== 'dispose' && k !== 'suspend' && k !== 'restore'
      );
      expect(functionKeys).toHaveLength(0);
    });

    it('does not throw for empty agents', () => {
      expect(() => createAhiExtension({ agents: {} })).not.toThrow();
    });

    it('still includes dispose method', () => {
      const result = createAhiExtension({ agents: {} });
      expect(typeof result.dispose).toBe('function');
    });
  });

  // ============================================================
  // AC-17: ${MISSING_VAR} throws at init (explicit test)
  // ============================================================

  describe('AC-17: ${MISSING_VAR} throws at init', () => {
    it('throws before returning an ExtensionResult', () => {
      let result: ReturnType<typeof createAhiExtension> | undefined;
      let error: Error | undefined;

      try {
        result = createAhiExtension({
          agents: { svc: { url: 'http://${MISSING_VAR}' } },
        });
      } catch (e) {
        error = e as Error;
      }

      expect(result).toBeUndefined();
      expect(error).toBeDefined();
      expect(error!.message).toContain('MISSING_VAR');
    });
  });

  // ============================================================
  // General: env var substitution
  // ============================================================

  describe('env var substitution', () => {
    beforeEach(() => {
      process.env['AHI_HOST'] = 'agents.example.com';
      process.env['AHI_PORT'] = '8080';
    });

    afterEach(() => {
      delete process.env['AHI_HOST'];
      delete process.env['AHI_PORT'];
    });

    it('substitutes a single env var in a URL', () => {
      // No throw means substitution succeeded
      expect(() =>
        createAhiExtension({
          agents: { svc: { url: 'http://${AHI_HOST}/api' } },
        })
      ).not.toThrow();
    });

    it('substitutes multiple env vars in a single URL', () => {
      expect(() =>
        createAhiExtension({
          agents: { svc: { url: 'http://${AHI_HOST}:${AHI_PORT}/api' } },
        })
      ).not.toThrow();
    });

    it('throws when second of two vars is unset', () => {
      expect(() =>
        createAhiExtension({
          agents: { svc: { url: 'http://${AHI_HOST}:${UNSET_PORT}/api' } },
        })
      ).toThrow('AHI: environment variable UNSET_PORT is not set');
    });
  });
});
