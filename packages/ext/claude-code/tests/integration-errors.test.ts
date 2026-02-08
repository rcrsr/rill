/**
 * Integration tests for Claude Code extension error contracts.
 * Tests error handling across factory, prompt, skill, command, and dispose.
 *
 * Covers: EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-8, EC-9, EC-10, EC-11, EC-12, EC-13, EC-14, EC-15, EC-16
 * Acceptance: AC-6, AC-7, AC-8, AC-9, AC-11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { createRuntimeContext, RuntimeError } from '@rcrsr/rill';

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
// EC-1: Invalid binaryPath at factory creation
// ============================================================

describe('EC-1: Invalid binaryPath at factory creation', () => {
  it('throws Error "Binary not found: {path}" when which.sync fails', async () => {
    const which = await import('which');

    // Mock which.sync to throw (binary not in PATH)
    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension({ binaryPath: '/invalid/claude' })
    ).toThrow('Binary not found: /invalid/claude');
  });

  it('throws for binary not in PATH', async () => {
    const which = await import('which');

    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension({ binaryPath: 'nonexistent-binary' })
    ).toThrow('Binary not found: nonexistent-binary');
  });
});

// ============================================================
// EC-2: Invalid defaultTimeout
// ============================================================

describe('EC-2: Invalid defaultTimeout', () => {
  it('throws Error for negative timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: -1000 })).toThrow(
      'Invalid timeout: must be positive integer, max 3600000'
    );
  });

  it('throws Error for zero timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 0 })).toThrow(
      'Invalid timeout: must be positive integer, max 3600000'
    );
  });

  it('throws Error for non-integer timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 1500.5 })).toThrow(
      'Invalid timeout: must be positive integer, max 3600000'
    );
  });

  it('throws Error for timeout exceeding max (3600000)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 3600001 })
    ).toThrow('Invalid timeout: must be positive integer, max 3600000');
  });
});

// ============================================================
// EC-3: Empty text to prompt
// ============================================================

describe('EC-3, AC-11: Empty text to prompt', () => {
  it('throws RuntimeError RILL-R004 "prompt text cannot be empty"', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['', {}], ctx)).rejects.toThrow(RuntimeError);

    await expect(ext.prompt.fn(['', {}], ctx)).rejects.toThrow(
      'prompt text cannot be empty'
    );
  });

  it('throws RuntimeError for whitespace-only text', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['   ', {}], ctx)).rejects.toThrow(
      'prompt text cannot be empty'
    );

    await expect(ext.prompt.fn(['\t\n  ', {}], ctx)).rejects.toThrow(
      'prompt text cannot be empty'
    );
  });
});

// ============================================================
// EC-4: Binary not found at spawn (ENOENT)
// ============================================================

describe('EC-4, AC-6: Binary not found at spawn (ENOENT)', () => {
  it('throws RuntimeError RILL-R004 "claude binary not found"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to throw ENOENT error
    const enoentError = new Error('spawn claude ENOENT') as Error & {
      code?: string;
    };
    enoentError.code = 'ENOENT';

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'claude binary not found',
        undefined,
        { binaryPath: 'claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      /claude binary not found/
    );
  });
});

// ============================================================
// EC-5: Permission denied (EACCES)
// ============================================================

describe('EC-5, AC-7: Permission denied (EACCES)', () => {
  it('throws RuntimeError RILL-R004 "Permission denied: claude"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to throw EACCES error
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Permission denied: claude',
        undefined,
        { binaryPath: '/usr/bin/claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      /Permission denied: claude/
    );
  });
});

// ============================================================
// EC-6: Generic spawn failure
// ============================================================

describe('EC-6: Generic spawn failure', () => {
  it('throws RuntimeError RILL-R004 "Failed to spawn claude binary: {error}"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to throw generic error
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Failed to spawn claude binary: Unknown spawn error',
        undefined,
        { binaryPath: 'claude', originalError: 'Unknown spawn error' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      /Failed to spawn claude binary/
    );
  });
});

// ============================================================
// EC-8: Timeout exceeded
// ============================================================

describe('EC-8, AC-8: Timeout exceeded', () => {
  it('throws RuntimeError RILL-R004 "Claude CLI timeout after {N}ms"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to return process that times out
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI timeout after 5000ms',
          undefined,
          { timeoutMs: 5000 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      /Claude CLI timeout after \d+ms/
    );
  });
});

// ============================================================
// EC-9: Non-zero exit code
// ============================================================

describe('EC-9, AC-9: Non-zero exit code', () => {
  it('throws RuntimeError RILL-R004 "Claude CLI exited with code {N}"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to return process that exits with code 1
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 1',
          undefined,
          { exitCode: 1 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      /Claude CLI exited with code \d+/
    );
  });

  it('throws RuntimeError for exit code 127', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to return process that exits with code 127
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 127',
          undefined,
          { exitCode: 127 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.prompt.fn(['test', {}], ctx)).rejects.toThrow(
      'Claude CLI exited with code 127'
    );
  });
});

// ============================================================
// EC-10: Empty skill name
// ============================================================

describe('EC-10: Empty skill name', () => {
  it('throws RuntimeError RILL-R004 "skill name cannot be empty"', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.skill.fn(['', {}], ctx)).rejects.toThrow(RuntimeError);

    await expect(ext.skill.fn(['', {}], ctx)).rejects.toThrow(
      'skill name cannot be empty'
    );
  });

  it('throws RuntimeError for whitespace-only skill name', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.skill.fn(['   ', {}], ctx)).rejects.toThrow(
      'skill name cannot be empty'
    );
  });
});

// ============================================================
// EC-11: Invalid skill name (non-zero exit)
// ============================================================

describe('EC-11: Invalid skill name (non-zero exit)', () => {
  it('throws RuntimeError RILL-R004 "Claude CLI exited with code {N}"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to return process that exits with non-zero code
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 2',
          undefined,
          { exitCode: 2 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.skill.fn(['invalid-skill', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.skill.fn(['invalid-skill', {}], ctx)).rejects.toThrow(
      /Claude CLI exited with code \d+/
    );
  });
});

// ============================================================
// EC-12: Skill spawn/parse/timeout
// ============================================================

describe('EC-12: Skill spawn/parse/timeout errors', () => {
  it('throws RuntimeError for spawn error (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Failed to spawn claude binary: test error',
        undefined,
        { binaryPath: 'claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.skill.fn(['test-skill', {}], ctx)).rejects.toThrow(
      /Failed to spawn claude binary/
    );
  });

  it('throws RuntimeError for timeout (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI timeout after 10000ms',
          undefined,
          { timeoutMs: 10000 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.skill.fn(['test-skill', {}], ctx)).rejects.toThrow(
      /Claude CLI timeout after \d+ms/
    );
  });
});

// ============================================================
// EC-13: Empty command name
// ============================================================

describe('EC-13: Empty command name', () => {
  it('throws RuntimeError RILL-R004 "command name cannot be empty"', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.command.fn(['', {}], ctx)).rejects.toThrow(RuntimeError);

    await expect(ext.command.fn(['', {}], ctx)).rejects.toThrow(
      'command name cannot be empty'
    );
  });

  it('throws RuntimeError for whitespace-only command name', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.command.fn(['\t\n', {}], ctx)).rejects.toThrow(
      'command name cannot be empty'
    );
  });
});

// ============================================================
// EC-14: Invalid command (non-zero exit)
// ============================================================

describe('EC-14: Invalid command (non-zero exit)', () => {
  it('throws RuntimeError RILL-R004 "Claude CLI exited with code {N}"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 3',
          undefined,
          { exitCode: 3 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.command.fn(['invalid-command', {}], ctx)).rejects.toThrow(
      RuntimeError
    );

    await expect(ext.command.fn(['invalid-command', {}], ctx)).rejects.toThrow(
      /Claude CLI exited with code \d+/
    );
  });
});

// ============================================================
// EC-15: Command spawn/parse/timeout
// ============================================================

describe('EC-15: Command spawn/parse/timeout errors', () => {
  it('throws RuntimeError for spawn error (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'claude binary not found',
        undefined,
        { binaryPath: 'claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.command.fn(['test-command', {}], ctx)).rejects.toThrow(
      /claude binary not found/
    );
  });

  it('throws RuntimeError for timeout (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI timeout after 15000ms',
          undefined,
          { timeoutMs: 15000 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.command.fn(['test-command', {}], ctx)).rejects.toThrow(
      /Claude CLI timeout after \d+ms/
    );
  });

  it('throws RuntimeError for permission denied (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Permission denied: claude',
        undefined,
        { binaryPath: '/usr/bin/claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    await expect(ext.command.fn(['test-command', {}], ctx)).rejects.toThrow(
      /Permission denied: claude/
    );
  });
});

// ============================================================
// EC-16: Cleanup failure on dispose
// ============================================================

describe('EC-16: Cleanup failure on dispose', () => {
  it('logs warning and does not throw when dispose cleanup fails', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Create a dispose function that throws
    const failingDispose = vi.fn(() => {
      throw new Error('Cleanup failure');
    });

    // Return a pending promise so dispose is called while process is still running
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: new Promise(() => {}), // Never resolves
      dispose: failingDispose,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start prompt (don't await - it will never complete)
    const promptPromise = ext.prompt.fn(['test', {}], ctx);

    // Dispose while process is still running - should log warning, not throw
    expect(() => ext.dispose?.()).not.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cleanup process')
    );

    consoleWarnSpy.mockRestore();

    // Catch the unresolved promise to avoid warnings
    promptPromise.catch(() => {});
  });

  it('continues cleanup for all disposers even if one fails', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Create multiple disposers - first fails, second succeeds
    const failingDispose = vi.fn(() => {
      throw new Error('Cleanup failure');
    });
    const successDispose = vi.fn();

    let callCount = 0;
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      callCount++;
      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise(() => {}), // Never resolves
        dispose: callCount === 1 ? failingDispose : successDispose,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start two prompts (don't await - they will never complete)
    const promise1 = ext.prompt.fn(['test1', {}], ctx);
    const promise2 = ext.prompt.fn(['test2', {}], ctx);

    // Dispose should call both, log warning for first, not throw
    expect(() => ext.dispose?.()).not.toThrow();

    expect(failingDispose).toHaveBeenCalled();
    expect(successDispose).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cleanup process')
    );

    consoleWarnSpy.mockRestore();

    // Catch the unresolved promises to avoid warnings
    promise1.catch(() => {});
    promise2.catch(() => {});
  });

  it('handles non-Error cleanup failures', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Disposer throws non-Error object
    const failingDispose = vi.fn(() => {
      throw 'string error';
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: new Promise(() => {}), // Never resolves
      dispose: failingDispose,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start prompt (don't await - it will never complete)
    const promptPromise = ext.prompt.fn(['test', {}], ctx);

    expect(() => ext.dispose?.()).not.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cleanup process: Unknown error')
    );

    consoleWarnSpy.mockRestore();

    // Catch the unresolved promise to avoid warnings
    promptPromise.catch(() => {});
  });
});
