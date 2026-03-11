/**
 * Environment variable merging tests
 * Validates deriveEnvPrefix(), mergeEnvIntoConfig(), and validateRequiredFields().
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  deriveEnvPrefix,
  mergeEnvIntoConfig,
  validateRequiredFields,
} from '../../src/run/env.js';
import type { ConfigFile } from '../../src/run/types.js';

function makeConfig(overrides: Partial<ConfigFile> = {}): ConfigFile {
  return {
    extensions: {},
    modules: {},
    ...overrides,
  };
}

describe('deriveEnvPrefix', () => {
  it('converts llm.anthropic to LLM_ANTHROPIC', () => {
    expect(deriveEnvPrefix('llm.anthropic')).toBe('LLM_ANTHROPIC');
  });

  it('converts kv.redis to KV_REDIS', () => {
    expect(deriveEnvPrefix('kv.redis')).toBe('KV_REDIS');
  });

  it('converts a single-segment key like mcp to MCP', () => {
    expect(deriveEnvPrefix('mcp')).toBe('MCP');
  });

  it('converts deeply nested key a.b.c to A_B_C', () => {
    expect(deriveEnvPrefix('a.b.c')).toBe('A_B_C');
  });

  it('uppercases all letters', () => {
    expect(deriveEnvPrefix('fs.s3')).toBe('FS_S3');
  });
});

describe('mergeEnvIntoConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('env var value overrides JSON config value', () => {
    const config = makeConfig({
      extensions: {
        'llm.anthropic': {
          package: '@rcrsr/rill-ext-anthropic',
          config: { api_key: 'from-json', model: 'claude-3' },
        },
      },
    });

    process.env['LLM_ANTHROPIC_API_KEY'] = 'from-env';

    try {
      const merged = mergeEnvIntoConfig(config);
      expect(merged.extensions['llm.anthropic']?.config?.['api_key']).toBe(
        'from-env'
      );
      expect(merged.extensions['llm.anthropic']?.config?.['model']).toBe(
        'claude-3'
      );
    } finally {
      delete process.env['LLM_ANTHROPIC_API_KEY'];
    }
  });

  it('adds env var fields not present in JSON config', () => {
    const config = makeConfig({
      extensions: {
        'llm.anthropic': {
          package: '@rcrsr/rill-ext-anthropic',
          config: {},
        },
      },
    });

    process.env['LLM_ANTHROPIC_MODEL'] = 'claude-3-haiku';

    try {
      const merged = mergeEnvIntoConfig(config);
      expect(merged.extensions['llm.anthropic']?.config?.['model']).toBe(
        'claude-3-haiku'
      );
    } finally {
      delete process.env['LLM_ANTHROPIC_MODEL'];
    }
  });

  it('does not throw when .env file is absent', () => {
    const config = makeConfig({
      extensions: {
        mcp: { package: '@rcrsr/rill-ext-mcp', config: {} },
      },
    });
    expect(() => mergeEnvIntoConfig(config)).not.toThrow();
  });

  it('processes extensions with no config fields without merging anything', () => {
    const config = makeConfig({
      extensions: {
        mcp: { package: '@rcrsr/rill-ext-mcp', config: {} },
      },
    });
    const merged = mergeEnvIntoConfig(config);
    expect(merged.extensions['mcp']?.config).toBeDefined();
  });

  it('preserves modules map after merge', () => {
    const config = makeConfig({
      extensions: {},
      modules: { utils: '/path/to/utils.rill' },
    });
    const merged = mergeEnvIntoConfig(config);
    expect(merged.modules?.['utils']).toBe('/path/to/utils.rill');
  });

  it('does not bleed env vars from one extension into another', () => {
    const config = makeConfig({
      extensions: {
        'llm.anthropic': {
          package: '@rcrsr/rill-ext-anthropic',
          config: { model: 'claude-3' },
        },
        'llm.openai': {
          package: '@rcrsr/rill-ext-openai',
          config: { model: 'gpt-4' },
        },
      },
    });

    process.env['LLM_ANTHROPIC_API_KEY'] = 'anthropic-key';
    process.env['LLM_OPENAI_API_KEY'] = 'openai-key';

    try {
      const merged = mergeEnvIntoConfig(config);
      expect(merged.extensions['llm.anthropic']?.config?.['api_key']).toBe(
        'anthropic-key'
      );
      expect(merged.extensions['llm.openai']?.config?.['api_key']).toBe(
        'openai-key'
      );
      expect(
        merged.extensions['llm.anthropic']?.config?.['openai_api_key']
      ).toBeUndefined();
    } finally {
      delete process.env['LLM_ANTHROPIC_API_KEY'];
      delete process.env['LLM_OPENAI_API_KEY'];
    }
  });
});

describe('validateRequiredFields', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with EC-4 message format when required field is missing', () => {
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
      expect(() =>
        validateRequiredFields('llm.anthropic', {}, ['api_key'])
      ).toThrow('process.exit called');
      expect(stderr).toContain("llm.anthropic: missing 'api_key'");
      expect(stderr).toContain('LLM_ANTHROPIC_API_KEY');
    } finally {
      (process.stderr.write as unknown) = origStderr;
    }
  });

  it('includes "Set <ENV_VAR> or add to config" in error message', () => {
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
      expect(() =>
        validateRequiredFields('llm.anthropic', {}, ['api_key'])
      ).toThrow('process.exit called');
      expect(stderr).toContain('Set LLM_ANTHROPIC_API_KEY or add to config');
    } finally {
      (process.stderr.write as unknown) = origStderr;
    }
  });

  it('does not exit when all required fields are present', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    expect(() =>
      validateRequiredFields(
        'llm.anthropic',
        { api_key: 'key', model: 'claude-3' },
        ['api_key', 'model']
      )
    ).not.toThrow();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits on the first missing field when multiple fields are required', () => {
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
      expect(() =>
        validateRequiredFields('llm.anthropic', {}, ['api_key', 'model'])
      ).toThrow('process.exit called');
      expect(stderr).toContain("missing 'api_key'");
    } finally {
      (process.stderr.write as unknown) = origStderr;
    }
  });

  it('exits when required field value is empty string', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    const origStderr = process.stderr.write.bind(process.stderr);
    (process.stderr.write as unknown) = (_chunk: string) => true;

    try {
      expect(() =>
        validateRequiredFields('mcp', { api_key: '' }, ['api_key'])
      ).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      (process.stderr.write as unknown) = origStderr;
    }
  });

  it('derives correct env var name for single-segment namespace', () => {
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
      expect(() => validateRequiredFields('mcp', {}, ['server_url'])).toThrow(
        'process.exit called'
      );
      expect(stderr).toContain('MCP_SERVER_URL');
    } finally {
      (process.stderr.write as unknown) = origStderr;
    }
  });
});
