/**
 * Integration tests for Claude Code extension configuration validation.
 * Tests factory configuration, defaults, and timeout handling.
 *
 * Covers: IR-1, AC-3, EC-1, EC-2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { createRuntimeContext } from '@rcrsr/rill';

// ============================================================
// MOCKS
// ============================================================

// Mock which module for binary validation
vi.mock('which', () => ({
  default: {
    sync: vi.fn(),
  },
}));

// Mock node-pty to avoid native module
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock process module
vi.mock('../src/process.js');

// Mock stream parser
vi.mock('../src/stream-parser.js');

// Mock result extractor
vi.mock('../src/result.js');

// ============================================================
// SETUP
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// IR-1: createClaudeCodeExtension(config?: ClaudeCodeConfig)
// ============================================================

describe('IR-1: createClaudeCodeExtension factory configuration', () => {
  describe('Default config (no args)', () => {
    it('uses binaryPath "claude" when not specified', async () => {
      const which = await import('which');
      vi.mocked(which.default.sync).mockReturnValue('claude');

      const ext = createClaudeCodeExtension();

      expect(which.default.sync).toHaveBeenCalledWith('claude');
      expect(ext.prompt).toBeDefined();
      expect(ext.skill).toBeDefined();
      expect(ext.command).toBeDefined();
      expect(ext.dispose).toBeDefined();
    });

    it('uses defaultTimeout 30000 when not specified', async () => {
      const which = await import('which');
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(which.default.sync).mockReturnValue('claude');
      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 3,
        },
        cost: 0.001,
        exitCode: 0,
        duration: 500,
      });
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension();
      const ctx = createRuntimeContext();

      await ext.prompt.fn(['Test prompt', {}], ctx);

      // Verify default timeout 30000 was used
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 30000 })
      );
    });

    it('creates extension with all required functions', async () => {
      const which = await import('which');
      vi.mocked(which.default.sync).mockReturnValue('claude');

      const ext = createClaudeCodeExtension();

      expect(ext.prompt).toBeDefined();
      expect(ext.prompt.fn).toBeInstanceOf(Function);
      expect(ext.prompt.params).toBeDefined();
      expect(ext.skill).toBeDefined();
      expect(ext.skill.fn).toBeInstanceOf(Function);
      expect(ext.skill.params).toBeDefined();
      expect(ext.command).toBeDefined();
      expect(ext.command.fn).toBeInstanceOf(Function);
      expect(ext.command.params).toBeDefined();
      expect(ext.dispose).toBeInstanceOf(Function);
    });
  });

  describe('Custom binaryPath resolves correctly', () => {
    it('validates and uses custom binaryPath', async () => {
      const which = await import('which');
      vi.mocked(which.default.sync).mockReturnValue('/usr/local/bin/claude');

      const ext = createClaudeCodeExtension({
        binaryPath: '/usr/local/bin/claude',
      });

      expect(which.default.sync).toHaveBeenCalledWith('/usr/local/bin/claude');
      expect(ext.prompt).toBeDefined();
    });

    it('validates binary exists in PATH at factory creation', async () => {
      const which = await import('which');
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(which.default.sync).mockReturnValue('custom-claude');
      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 3,
        },
        cost: 0.001,
        exitCode: 0,
        duration: 500,
      });
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({ binaryPath: 'custom-claude' });
      const ctx = createRuntimeContext();

      await ext.prompt.fn(['Test', {}], ctx);

      // Verify custom binary path was used
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({ binaryPath: 'custom-claude' })
      );
    });
  });

  describe('Custom defaultTimeout propagated', () => {
    it('propagates custom defaultTimeout to process manager', async () => {
      const which = await import('which');
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(which.default.sync).mockReturnValue('claude');
      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 3,
        },
        cost: 0.001,
        exitCode: 0,
        duration: 500,
      });
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({ defaultTimeout: 60000 });
      const ctx = createRuntimeContext();

      await ext.prompt.fn(['Test prompt', {}], ctx);

      // Verify custom default timeout 60000 was used
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 60000 })
      );
    });

    it('accepts maximum timeout value 300000', async () => {
      const which = await import('which');
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(which.default.sync).mockReturnValue('claude');
      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 3,
        },
        cost: 0.001,
        exitCode: 0,
        duration: 500,
      });
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({ defaultTimeout: 300000 });
      const ctx = createRuntimeContext();

      await ext.prompt.fn(['Test prompt', {}], ctx);

      // Verify maximum timeout was accepted
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 300000 })
      );
    });
  });
});

// ============================================================
// AC-3: Custom timeout respects timeout option value
// ============================================================

describe('AC-3: Custom timeout respects timeout option value', () => {
  it('PromptOptions timeout overrides defaultTimeout for prompt', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: 'Response',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 500,
    });
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.resolve(0),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({ defaultTimeout: 30000 });
    const ctx = createRuntimeContext();

    await ext.prompt.fn(['Test prompt', { timeout: 90000 }], ctx);

    // Verify timeout option overrides default
    expect(spawnClaudeCli).toHaveBeenCalledWith(
      'Test prompt',
      expect.objectContaining({ timeoutMs: 90000 })
    );
  });

  it('PromptOptions timeout overrides defaultTimeout for skill', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: 'Skill result',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 500,
    });
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.resolve(0),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({ defaultTimeout: 30000 });
    const ctx = createRuntimeContext();

    await ext.skill.fn(['test-skill', { timeout: 120000 }], ctx);

    // Verify timeout option overrides default for skill
    expect(spawnClaudeCli).toHaveBeenCalledWith(
      expect.stringContaining('/test-skill'),
      expect.objectContaining({ timeoutMs: 120000 })
    );
  });

  it('PromptOptions timeout overrides defaultTimeout for command', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: 'Command result',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 500,
    });
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.resolve(0),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({ defaultTimeout: 30000 });
    const ctx = createRuntimeContext();

    await ext.command.fn(['test-command', { timeout: 150000 }], ctx);

    // Verify timeout option overrides default for command
    expect(spawnClaudeCli).toHaveBeenCalledWith(
      expect.stringContaining('/test-command'),
      expect.objectContaining({ timeoutMs: 150000 })
    );
  });

  it('uses defaultTimeout when timeout option not provided', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: 'Response',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 500,
    });
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.resolve(0),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({ defaultTimeout: 45000 });
    const ctx = createRuntimeContext();

    await ext.prompt.fn(['Test prompt', {}], ctx);

    // Verify default timeout was used when option not provided
    expect(spawnClaudeCli).toHaveBeenCalledWith(
      'Test prompt',
      expect.objectContaining({ timeoutMs: 45000 })
    );
  });
});

// ============================================================
// EC-1: Invalid binaryPath at factory creation
// ============================================================

describe('EC-1: Invalid binaryPath at factory creation', () => {
  it('throws Error "Binary not found: {path}" when binary does not exist', async () => {
    const which = await import('which');

    // Mock which.sync to throw (binary not in PATH)
    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension({ binaryPath: '/nonexistent/claude' })
    ).toThrow('Binary not found: /nonexistent/claude');
  });

  it('throws for binary not in PATH', async () => {
    const which = await import('which');

    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension({ binaryPath: 'missing-binary' })
    ).toThrow('Binary not found: missing-binary');
  });

  it('validates binaryPath eagerly at factory creation time', async () => {
    const which = await import('which');

    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    // Validation happens immediately during createClaudeCodeExtension call
    expect(() => createClaudeCodeExtension({ binaryPath: 'bad-path' })).toThrow(
      'Binary not found: bad-path'
    );

    // Verify which.sync was called during factory creation
    expect(which.default.sync).toHaveBeenCalledWith('bad-path');
  });
});

// ============================================================
// EC-2: Invalid defaultTimeout
// ============================================================

describe('EC-2: Invalid defaultTimeout', () => {
  it('throws Error for negative timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: -5000 })).toThrow(
      'Invalid timeout: must be positive integer, max 300000'
    );
  });

  it('throws Error for zero timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 0 })).toThrow(
      'Invalid timeout: must be positive integer, max 300000'
    );
  });

  it('throws Error for non-integer timeout (decimal)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 2500.75 })
    ).toThrow('Invalid timeout: must be positive integer, max 300000');
  });

  it('throws Error for non-integer timeout (float)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 10000.1 })
    ).toThrow('Invalid timeout: must be positive integer, max 300000');
  });

  it('throws Error for timeout exceeding max (300000)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 300001 })).toThrow(
      'Invalid timeout: must be positive integer, max 300000'
    );
  });

  it('throws Error for timeout far exceeding max', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 500000 })).toThrow(
      'Invalid timeout: must be positive integer, max 300000'
    );
  });

  it('validates timeout eagerly at factory creation time', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Validation happens immediately during createClaudeCodeExtension call
    expect(() => createClaudeCodeExtension({ defaultTimeout: -1 })).toThrow(
      'Invalid timeout: must be positive integer, max 300000'
    );
  });

  it('accepts valid timeout at minimum (1ms)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Should not throw
    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 1 })
    ).not.toThrow();
  });

  it('accepts valid timeout at maximum (300000ms)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Should not throw
    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 300000 })
    ).not.toThrow();
  });
});
