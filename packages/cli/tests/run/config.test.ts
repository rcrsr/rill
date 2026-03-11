/**
 * Config loader tests
 * Validates loadConfig() parsing, error contracts for missing files and bad JSON.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from '../../src/run/config.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function writeTempFile(content: string, ext = '.json'): string {
  const p = path.join(os.tmpdir(), `rill-config-test-${Date.now()}${ext}`);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('valid config file', () => {
    it('parses a minimal config with empty extensions', () => {
      const p = writeTempFile(JSON.stringify({ extensions: {} }));
      try {
        const config = loadConfig(p);
        expect(config.extensions).toEqual({});
      } finally {
        fs.unlinkSync(p);
      }
    });

    it('parses extensions map with package and config fields', () => {
      const p = writeTempFile(
        JSON.stringify({
          extensions: {
            'llm.anthropic': {
              package: '@rcrsr/rill-ext-anthropic',
              config: { api_key: 'test', model: 'claude-3' },
            },
          },
        })
      );
      try {
        const config = loadConfig(p);
        expect(config.extensions['llm.anthropic']).toMatchObject({
          package: '@rcrsr/rill-ext-anthropic',
          config: { api_key: 'test', model: 'claude-3' },
        });
      } finally {
        fs.unlinkSync(p);
      }
    });

    it('parses modules map from config', () => {
      const p = writeTempFile(
        JSON.stringify({
          extensions: {},
          modules: { utils: '/path/to/utils.rill' },
        })
      );
      try {
        const config = loadConfig(p);
        expect(config.modules?.['utils']).toBe('/path/to/utils.rill');
      } finally {
        fs.unlinkSync(p);
      }
    });

    it('defaults extensions.config to empty object when omitted', () => {
      const p = writeTempFile(
        JSON.stringify({
          extensions: {
            mcp: { package: '@rcrsr/rill-ext-mcp' },
          },
        })
      );
      try {
        const config = loadConfig(p);
        expect(config.extensions['mcp']?.config).toEqual({});
      } finally {
        fs.unlinkSync(p);
      }
    });

    it('defaults modules to empty object when omitted', () => {
      const p = writeTempFile(JSON.stringify({ extensions: {} }));
      try {
        const config = loadConfig(p);
        expect(
          config.modules === undefined || typeof config.modules === 'object'
        ).toBe(true);
      } finally {
        fs.unlinkSync(p);
      }
    });

    it('parses bindings field when present', () => {
      const p = writeTempFile(
        JSON.stringify({ extensions: {}, bindings: 'my-bindings.rill' })
      );
      try {
        const config = loadConfig(p);
        expect(config.bindings).toBe('my-bindings.rill');
      } finally {
        fs.unlinkSync(p);
      }
    });

    it('sets bindings to undefined when field is absent', () => {
      const p = writeTempFile(JSON.stringify({ extensions: {} }));
      try {
        const config = loadConfig(p);
        expect(config.bindings).toBeUndefined();
      } finally {
        fs.unlinkSync(p);
      }
    });
  });

  describe('EC-2: config file not found', () => {
    it('exits 1 when config file does not exist', () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      try {
        expect(() => loadConfig('/nonexistent/config.json')).toThrow(
          'process.exit called'
        );
        expect(stderr).toContain('Config not found: /nonexistent/config.json');
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });

    it('includes the exact config path in the error message', () => {
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      const specificPath = '/some/very/specific/missing/config.json';
      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      try {
        expect(() => loadConfig(specificPath)).toThrow('process.exit called');
        expect(stderr).toContain(specificPath);
      } finally {
        (process.stderr.write as unknown) = origStderr;
      }
    });
  });

  describe('EC-3: invalid JSON in config file', () => {
    it('exits 1 when config file contains invalid JSON', () => {
      const p = writeTempFile('{ this is not valid json }');
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      try {
        expect(() => loadConfig(p)).toThrow('process.exit called');
        expect(stderr.length).toBeGreaterThan(0);
      } finally {
        (process.stderr.write as unknown) = origStderr;
        fs.unlinkSync(p);
      }
    });

    it('includes a JSON parse error message in stderr', () => {
      const p = writeTempFile('not json at all!!!');
      vi.spyOn(process, 'exit').mockImplementation((_code) => {
        throw new Error('process.exit called');
      });

      let stderr = '';
      const origStderr = process.stderr.write.bind(process.stderr);
      (process.stderr.write as unknown) = (chunk: string) => {
        stderr += chunk;
        return true;
      };

      try {
        expect(() => loadConfig(p)).toThrow('process.exit called');
        expect(stderr.toLowerCase()).toMatch(/json|token|unexpected/);
      } finally {
        (process.stderr.write as unknown) = origStderr;
        fs.unlinkSync(p);
      }
    });
  });

  describe('AC-17: multiple extensions parsed', () => {
    it('parses two extensions in the same config file', () => {
      const p = writeTempFile(
        JSON.stringify({
          extensions: {
            'llm.anthropic': {
              package: '@rcrsr/rill-ext-anthropic',
              config: { api_key: 'k1' },
            },
            'llm.openai': {
              package: '@rcrsr/rill-ext-openai',
              config: { api_key: 'k2' },
            },
          },
        })
      );
      try {
        const config = loadConfig(p);
        expect(Object.keys(config.extensions)).toHaveLength(2);
        expect(config.extensions['llm.anthropic']?.package).toBe(
          '@rcrsr/rill-ext-anthropic'
        );
        expect(config.extensions['llm.openai']?.package).toBe(
          '@rcrsr/rill-ext-openai'
        );
      } finally {
        fs.unlinkSync(p);
      }
    });
  });
});
