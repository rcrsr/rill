/**
 * Integration tests for Claude Code extension prefixFunctions and dispose.
 * Tests extension factory with prefixFunctions utility and cleanup lifecycle.
 *
 * Covers: IC-7, IR-1, IR-5, EC-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import type { ClaudeCodeResult } from '../src/types.js';

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
// IR-1: Factory result works with prefixFunctions
// ============================================================

describe('IR-1: Factory result works with prefixFunctions', () => {
  it('produces namespaced functions claude-code::prompt, claude-code::skill, claude-code::command', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const prefixed = prefixFunctions('claude-code', ext);

    // Verify namespaced function names exist
    expect(prefixed['claude-code::prompt']).toBeDefined();
    expect(prefixed['claude-code::skill']).toBeDefined();
    expect(prefixed['claude-code::command']).toBeDefined();

    // Verify original function names are removed
    expect(prefixed['prompt']).toBeUndefined();
    expect(prefixed['skill']).toBeUndefined();
    expect(prefixed['command']).toBeUndefined();
  });

  it('preserves dispose method after prefixFunctions', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const prefixed = prefixFunctions('claude-code', ext);

    // Verify dispose is preserved and not namespaced
    expect(prefixed.dispose).toBeDefined();
    expect(typeof prefixed.dispose).toBe('function');
    expect(prefixed['claude-code::dispose']).toBeUndefined();
  });

  it('preserves function definitions through prefixFunctions', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const prefixed = prefixFunctions('claude-code', ext);

    // Verify function definitions are intact
    const promptDef = prefixed['claude-code::prompt'];
    expect(promptDef.params).toHaveLength(2);
    expect(promptDef.params[0].name).toBe('text');
    expect(promptDef.params[0].type).toBe('string');
    expect(promptDef.params[1].name).toBe('options');
    expect(promptDef.params[1].type).toBe('dict');
    expect(promptDef.fn).toBeInstanceOf(Function);
    expect(promptDef.description).toBeTruthy();
    expect(promptDef.returnType).toBe('dict');
  });

  it('allows prefixed functions to be called via runtime context', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Setup mocks
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Success',
      tokens: {
        prompt: 10,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 5,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      exitCode: Promise.resolve(0),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const prefixed = prefixFunctions('claude-code', ext);
    const ctx = createRuntimeContext();

    // Call prefixed function
    const result = await prefixed['claude-code::prompt'].fn(
      ['Test prompt', {}],
      ctx
    );

    // Verify execution succeeded
    expect(result).toBeDefined();
    expect((result as ClaudeCodeResult).exitCode).toBe(0);
  });
});

// ============================================================
// IR-5: dispose terminates active child processes
// ============================================================

describe('IR-5: dispose terminates active child processes', () => {
  it('calls dispose on active processes when extension dispose is invoked', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track dispose calls
    const disposeFn = vi.fn();

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn((_cb) => {
          // Don't resolve immediately to keep process active
        }),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      exitCode: new Promise(() => {
        // Never resolves to keep process active
      }),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start prompt but don't await completion
    const promise = ext.prompt.fn(['Test', {}], ctx);

    // Wait briefly for process to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify dispose not called yet
    expect(disposeFn).not.toHaveBeenCalled();

    // Call extension dispose
    ext.dispose!();

    // Verify dispose was called
    expect(disposeFn).toHaveBeenCalledTimes(1);

    // Cleanup: ensure promise doesn't hang test
    promise.catch(() => {});
  });

  it('terminates multiple concurrent active processes', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const disposeFns: Array<() => void> = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const disposeFn = vi.fn();
      disposeFns.push(disposeFn);

      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        exitCode: new Promise(() => {
          // Never resolves
        }),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start 5 concurrent prompts
    const promises = Array.from({ length: 5 }, (_, i) =>
      ext.prompt.fn([`Prompt ${i}`, {}], ctx)
    );

    // Wait briefly for processes to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify all dispose functions created
    expect(disposeFns).toHaveLength(5);

    // Verify no dispose calls yet
    disposeFns.forEach((fn) => {
      expect(fn).not.toHaveBeenCalled();
    });

    // Call extension dispose
    ext.dispose!();

    // Verify all dispose functions called
    disposeFns.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    // Cleanup: ensure promises don't hang test
    promises.forEach((p) => p.catch(() => {}));
  });
});

// ============================================================
// IR-5: dispose is idempotent (multiple calls safe)
// ============================================================

describe('IR-5: dispose is idempotent (multiple calls safe)', () => {
  it('allows multiple dispose calls without errors', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();

    // Call dispose multiple times
    expect(() => ext.dispose!()).not.toThrow();
    expect(() => ext.dispose!()).not.toThrow();
    expect(() => ext.dispose!()).not.toThrow();
  });

  it('does not call process dispose multiple times', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const disposeFn = vi.fn();

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      exitCode: new Promise(() => {
        // Never resolves
      }),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start process
    const promise = ext.prompt.fn(['Test', {}], ctx);

    // Wait briefly
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Call extension dispose multiple times
    ext.dispose!();
    ext.dispose!();
    ext.dispose!();

    // Verify process dispose called only once (idempotent)
    expect(disposeFn).toHaveBeenCalledTimes(1);

    // Cleanup
    promise.catch(() => {});
  });

  it('clears active process tracker after first dispose', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const disposeFns: Array<() => void> = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const disposeFn = vi.fn();
      disposeFns.push(disposeFn);

      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        exitCode: new Promise(() => {}),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start 3 processes
    const promises = [
      ext.prompt.fn(['Test 1', {}], ctx),
      ext.prompt.fn(['Test 2', {}], ctx),
      ext.prompt.fn(['Test 3', {}], ctx),
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));

    // First dispose
    ext.dispose!();

    // Verify all 3 disposed
    expect(disposeFns).toHaveLength(3);
    disposeFns.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    // Reset mock call counts
    disposeFns.forEach((fn) => fn.mockClear());

    // Second dispose should not call any dispose functions (tracker cleared)
    ext.dispose!();

    disposeFns.forEach((fn) => {
      expect(fn).not.toHaveBeenCalled();
    });

    // Cleanup
    promises.forEach((p) => p.catch(() => {}));
  });
});

// ============================================================
// EC-16: dispose cleanup failure logs warning, does not throw
// ============================================================

describe('EC-16: dispose cleanup failure logs warning, does not throw', () => {
  it('logs warning when process dispose throws error', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock console.warn to capture warnings
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const disposeFn = vi.fn(() => {
      throw new Error('Process cleanup failed');
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      exitCode: new Promise(() => {}),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start process
    const promise = ext.prompt.fn(['Test', {}], ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Call dispose - should not throw despite error
    expect(() => ext.dispose!()).not.toThrow();

    // Verify warning logged
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to cleanup process: Process cleanup failed'
    );

    // Cleanup
    warnSpy.mockRestore();
    promise.catch(() => {});
  });

  it('logs warning for unknown error types', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Throw non-Error object
    const disposeFn = vi.fn(() => {
      throw 'String error';
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      exitCode: new Promise(() => {}),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const promise = ext.prompt.fn(['Test', {}], ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Call dispose
    expect(() => ext.dispose!()).not.toThrow();

    // Verify generic warning logged
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to cleanup process: Unknown error'
    );

    warnSpy.mockRestore();
    promise.catch(() => {});
  });

  it('continues disposing remaining processes after one fails', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const disposeFns: Array<() => void> = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const index = disposeFns.length;
      const disposeFn = vi.fn(() => {
        // Second process throws error
        if (index === 1) {
          throw new Error('Dispose failed');
        }
      });
      disposeFns.push(disposeFn);

      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        exitCode: new Promise(() => {}),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start 3 processes
    const promises = [
      ext.prompt.fn(['Test 1', {}], ctx),
      ext.prompt.fn(['Test 2', {}], ctx),
      ext.prompt.fn(['Test 3', {}], ctx),
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Dispose all
    expect(() => ext.dispose!()).not.toThrow();

    // Verify all 3 dispose functions called
    expect(disposeFns).toHaveLength(3);
    disposeFns.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    // Verify warning logged for failed disposal
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to cleanup process: Dispose failed'
    );

    warnSpy.mockRestore();
    promises.forEach((p) => p.catch(() => {}));
  });
});

// ============================================================
// IR-1: Factory creation is idempotent
// ============================================================

describe('IR-1: Factory creation is idempotent', () => {
  it('allows multiple factory calls with same config', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const config = { binaryPath: 'claude', defaultTimeout: 1800000 };

    // Create multiple instances
    const ext1 = createClaudeCodeExtension(config);
    const ext2 = createClaudeCodeExtension(config);
    const ext3 = createClaudeCodeExtension(config);

    // Verify all created successfully
    expect(ext1.prompt).toBeDefined();
    expect(ext2.prompt).toBeDefined();
    expect(ext3.prompt).toBeDefined();

    // Verify each has own dispose function
    expect(ext1.dispose).toBeDefined();
    expect(ext2.dispose).toBeDefined();
    expect(ext3.dispose).toBeDefined();

    // Verify dispose functions are independent
    expect(ext1.dispose).not.toBe(ext2.dispose);
    expect(ext2.dispose).not.toBe(ext3.dispose);
  });

  it('creates independent instances that do not share state', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const disposeFn = vi.fn();
      // Store dispose function for verification
      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        exitCode: new Promise(() => {}),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 100,
    });

    const ext1 = createClaudeCodeExtension();
    const ext2 = createClaudeCodeExtension();
    const ext3 = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start process on each instance
    const promise1 = ext1.prompt.fn(['Test 1', {}], ctx);
    const promise2 = ext2.prompt.fn(['Test 2', {}], ctx);
    const promise3 = ext3.prompt.fn(['Test 3', {}], ctx);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Dispose first instance only
    ext1.dispose!();

    // Track which dispose was called
    const disposeCalls = vi.mocked(spawnClaudeCli).mock.results.map((r) => {
      const proc = r.value;
      return proc.dispose.mock.calls.length;
    });

    // Verify only first process disposed
    expect(disposeCalls[0]).toBe(1); // ext1 process
    expect(disposeCalls[1]).toBe(0); // ext2 process (not disposed)
    expect(disposeCalls[2]).toBe(0); // ext3 process (not disposed)

    // Dispose second instance
    ext2.dispose!();

    const disposeCalls2 = vi.mocked(spawnClaudeCli).mock.results.map((r) => {
      const proc = r.value;
      return proc.dispose.mock.calls.length;
    });

    expect(disposeCalls2[0]).toBe(1); // ext1 (already disposed)
    expect(disposeCalls2[1]).toBe(1); // ext2 (now disposed)
    expect(disposeCalls2[2]).toBe(0); // ext3 (still not disposed)

    // Cleanup
    [promise1, promise2, promise3].forEach((p) => p.catch(() => {}));
  });

  it('creates instances with different configs independently', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext1 = createClaudeCodeExtension({ defaultTimeout: 10000 });
    const ext2 = createClaudeCodeExtension({ defaultTimeout: 20000 });
    const ext3 = createClaudeCodeExtension({ defaultTimeout: 30000 });

    // Verify all created with different configs
    expect(ext1.prompt).toBeDefined();
    expect(ext2.prompt).toBeDefined();
    expect(ext3.prompt).toBeDefined();

    // Verify independence
    expect(ext1.dispose).not.toBe(ext2.dispose);
    expect(ext2.dispose).not.toBe(ext3.dispose);
  });
});
