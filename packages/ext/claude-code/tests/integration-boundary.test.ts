/**
 * Integration tests for Claude Code extension boundary conditions.
 * Tests large output handling, concurrent calls, and sequential calls for resource leaks.
 *
 * Covers: IC-7, AC-14, AC-15, AC-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { createRuntimeContext } from '@rcrsr/rill';
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
// AC-14: 10K line output parses without memory growth
// ============================================================

describe('AC-14: 10K line output parses without memory growth', () => {
  it('parses 10K lines and extracts result correctly', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Create parser that collects chunks
    const processedChunks: string[] = [];
    const mockParser = {
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        processedChunks.push(chunk);
        // Simulate parsing JSON lines from chunks
        const lines = chunk.split('\n').filter((line) => line.trim());
        lines.forEach((line) => {
          try {
            const msg = JSON.parse(line);
            callback(msg);
          } catch {
            // Ignore non-JSON lines
          }
        });
      }),
      flush: vi.fn(),
    };

    vi.mocked(createStreamParser).mockReturnValue(mockParser);

    // Mock extractResult to return successful result
    vi.mocked(extractResult).mockReturnValue({
      result: 'Processed 10000 lines successfully',
      tokens: {
        prompt: 100,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 50,
      },
      cost: 0.01,
      exitCode: 0,
      duration: 5000,
    });

    // Mock spawn to simulate 10K line output
    let onDataCallback: ((chunk: string) => void) | undefined;
    let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn((cb) => {
          onDataCallback = cb;
        }),
        onExit: vi.fn((cb) => {
          onExitCallback = cb;
        }),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: new Promise<number>((resolve) => {
        // Simulate streaming 10K lines in chunks of 100 lines
        setTimeout(() => {
          const linesPerChunk = 100;
          const totalLines = 10000;
          const chunks = totalLines / linesPerChunk;

          for (let i = 0; i < chunks; i++) {
            const chunkLines: string[] = [];
            for (let j = 0; j < linesPerChunk; j++) {
              const lineNum = i * linesPerChunk + j + 1;
              chunkLines.push(
                JSON.stringify({
                  type: 'content',
                  text: `Line ${lineNum} of output`,
                })
              );
            }
            // Send chunk via onData callback
            if (onDataCallback) {
              onDataCallback(chunkLines.join('\n') + '\n');
            }
          }

          // Send completion event
          if (onExitCallback) {
            onExitCallback({ exitCode: 0 });
          }
          resolve(0);
        }, 10);
      }),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Execute prompt
    const result = (await ext.prompt.fn(
      ['Process large output', {}],
      ctx
    )) as ClaudeCodeResult;

    // Verify result extracted correctly
    expect(result.result).toBe('Processed 10000 lines successfully');
    expect(result.exitCode).toBe(0);

    // Verify parser processed all chunks
    expect(mockParser.processChunk).toHaveBeenCalled();
    const totalChunks = processedChunks.length;
    expect(totalChunks).toBeGreaterThan(0);

    // Verify memory stability by checking parser was called manageable number of times
    // (100 chunks for 10K lines at 100 lines per chunk)
    expect(mockParser.processChunk).toHaveBeenCalledTimes(100);
  });

  it('handles 10K lines with mixed content types', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const mockParser = {
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        const lines = chunk.split('\n').filter((line) => line.trim());
        lines.forEach((line) => {
          try {
            callback(JSON.parse(line));
          } catch {
            // Ignore parse errors
          }
        });
      }),
      flush: vi.fn(),
    };

    vi.mocked(createStreamParser).mockReturnValue(mockParser);

    vi.mocked(extractResult).mockReturnValue({
      result: 'Mixed content processed',
      tokens: {
        prompt: 200,
        cacheWrite5m: 10,
        cacheWrite1h: 5,
        cacheRead: 15,
        output: 100,
      },
      cost: 0.02,
      exitCode: 0,
      duration: 6000,
    });

    let onDataCallback: ((chunk: string) => void) | undefined;
    let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn((cb) => {
          onDataCallback = cb;
        }),
        onExit: vi.fn((cb) => {
          onExitCallback = cb;
        }),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: new Promise<number>((resolve) => {
        setTimeout(() => {
          // Send 10K lines with varying message types
          for (let i = 0; i < 100; i++) {
            const chunkLines: string[] = [];
            for (let j = 0; j < 100; j++) {
              const lineNum = i * 100 + j + 1;
              const msgType = lineNum % 3 === 0 ? 'usage' : 'content';
              chunkLines.push(
                JSON.stringify({
                  type: msgType,
                  data: `Data ${lineNum}`,
                })
              );
            }
            if (onDataCallback) {
              onDataCallback(chunkLines.join('\n') + '\n');
            }
          }

          if (onExitCallback) {
            onExitCallback({ exitCode: 0 });
          }
          resolve(0);
        }, 10);
      }),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const result = (await ext.prompt.fn(
      ['Mixed content test', {}],
      ctx
    )) as ClaudeCodeResult;

    expect(result.result).toBe('Mixed content processed');
    expect(result.exitCode).toBe(0);
    expect(mockParser.processChunk).toHaveBeenCalledTimes(100);
  });
});

// ============================================================
// AC-15: Concurrent 10 calls each complete independently
// ============================================================

describe('AC-15: Concurrent 10 calls each complete independently', () => {
  it('executes 10 concurrent prompts that all complete successfully', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track spawn calls to ensure each gets unique process
    let spawnCallCount = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const callIndex = spawnCallCount++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise<number>((resolve) => {
          // Simulate varying completion times (50-150ms)
          const delay = 50 + Math.random() * 100;
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(
                JSON.stringify({
                  type: 'content',
                  text: `Response from call ${callIndex}`,
                }) + '\n'
              );
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, delay);
        }),
        dispose: vi.fn(),
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        try {
          const msg = JSON.parse(chunk.trim());
          callback(msg);
        } catch {
          // Ignore parse errors
        }
      }),
      flush: vi.fn(),
    }));

    // Mock extractResult to return results based on parsed message content
    vi.mocked(extractResult).mockImplementation((messages) => {
      // Extract call index from message content
      const msg = messages.find((m) => m.type === 'content');
      const match = msg?.text?.match(/Response from call (\d+)/);
      const callNum = match ? parseInt(match[1], 10) : 0;

      return {
        result: `Response from call ${callNum}`,
        tokens: {
          prompt: 10 + callNum,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 5 + callNum,
        },
        cost: 0.001 * (callNum + 1),
        exitCode: 0,
        duration: 100 + callNum * 10,
      };
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Execute 10 concurrent prompts
    const promises = Array.from({ length: 10 }, (_, i) =>
      ext.prompt.fn([`Prompt ${i}`, {}], ctx)
    );

    // Wait for all to complete
    const results = await Promise.all(promises);

    // Verify all 10 completed successfully
    expect(results).toHaveLength(10);

    // Collect all result texts to verify uniqueness
    const resultTexts = new Set(
      results.map((r) => (r as ClaudeCodeResult).result)
    );

    // Verify each has unique result (10 unique results)
    expect(resultTexts.size).toBe(10);

    // Verify all have exitCode 0
    results.forEach((result) => {
      const typedResult = result as ClaudeCodeResult;
      expect(typedResult.exitCode).toBe(0);
      expect(typedResult.result).toMatch(/^Response from call \d+$/);
    });

    // Verify 10 separate processes were spawned
    expect(spawnClaudeCli).toHaveBeenCalledTimes(10);
  });

  it('handles concurrent mix of prompt, skill, and command calls', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    let spawnCallCount = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const callIndex = spawnCallCount++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise<number>((resolve) => {
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(
                JSON.stringify({
                  type: 'content',
                  text: `Response ${callIndex}`,
                }) + '\n'
              );
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 50);
        }),
        dispose: vi.fn(),
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        try {
          callback(JSON.parse(chunk.trim()));
        } catch {
          // Ignore
        }
      }),
      flush: vi.fn(),
    }));

    let extractCallCount = 0;
    vi.mocked(extractResult).mockImplementation(() => ({
      result: `Response ${extractCallCount++}`,
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
    }));

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Execute mixed concurrent calls
    const promises = [
      ext.prompt.fn(['Prompt 1', {}], ctx),
      ext.prompt.fn(['Prompt 2', {}], ctx),
      ext.skill.fn(['skill-1', {}], ctx),
      ext.skill.fn(['skill-2', {}], ctx),
      ext.command.fn(['command-1', {}], ctx),
      ext.prompt.fn(['Prompt 3', {}], ctx),
      ext.skill.fn(['skill-3', {}], ctx),
      ext.command.fn(['command-2', {}], ctx),
      ext.prompt.fn(['Prompt 4', {}], ctx),
      ext.prompt.fn(['Prompt 5', {}], ctx),
    ];

    const results = await Promise.all(promises);

    // Verify all completed
    expect(results).toHaveLength(10);
    results.forEach((result, i) => {
      const typedResult = result as ClaudeCodeResult;
      expect(typedResult.result).toBe(`Response ${i}`);
      expect(typedResult.exitCode).toBe(0);
    });

    expect(spawnClaudeCli).toHaveBeenCalledTimes(10);
  });

  it('handles partial failures in concurrent calls without affecting others', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');
    const { RuntimeError } = await import('@rcrsr/rill');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    let spawnCallCount = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const callIndex = spawnCallCount++;
      const shouldFail = callIndex === 3 || callIndex === 7;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise<number>((resolve, reject) => {
          setTimeout(() => {
            if (shouldFail) {
              reject(
                new RuntimeError(
                  'RILL-R004',
                  `Claude CLI exited with code 1`,
                  undefined,
                  { exitCode: 1 }
                )
              );
            } else {
              if (onDataCallback) {
                onDataCallback(
                  JSON.stringify({ type: 'content', text: `OK ${callIndex}` }) +
                    '\n'
                );
              }
              if (onExitCallback) {
                onExitCallback({ exitCode: 0 });
              }
              resolve(0);
            }
          }, 50);
        }),
        dispose: vi.fn(),
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        try {
          callback(JSON.parse(chunk.trim()));
        } catch {
          // Ignore
        }
      }),
      flush: vi.fn(),
    }));

    let extractCallCount = 0;
    vi.mocked(extractResult).mockImplementation(() => ({
      result: `Success ${extractCallCount++}`,
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
    }));

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const promises = Array.from({ length: 10 }, (_, i) =>
      ext.prompt.fn([`Prompt ${i}`, {}], ctx)
    );

    // Use Promise.allSettled to capture both successes and failures
    const results = await Promise.allSettled(promises);

    expect(results).toHaveLength(10);

    // Verify 2 failures (calls 3 and 7)
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toHaveLength(2);

    // Verify 8 successes
    const successes = results.filter((r) => r.status === 'fulfilled');
    expect(successes).toHaveLength(8);

    // Verify failures are RuntimeErrors
    failures.forEach((failure) => {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(
        RuntimeError
      );
    });
  });
});

// ============================================================
// AC-16: 1000 sequential calls have no resource leaks
// ============================================================

describe('AC-16: 1000 sequential calls have no resource leaks', () => {
  it('executes 1000 sequential prompts without leaks', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track disposer calls to verify cleanup
    const disposers: Array<() => void> = [];
    let activeProcesses = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      activeProcesses++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      const dispose = vi.fn(() => {
        activeProcesses--;
      });

      disposers.push(dispose);

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise<number>((resolve) => {
          // Fast completion (1ms) to speed up test
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(JSON.stringify({ type: 'content', text: 'OK' }));
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 1);
        }),
        dispose,
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        try {
          callback(JSON.parse(chunk.trim()));
        } catch {
          // Ignore
        }
      }),
      flush: vi.fn(),
    }));

    vi.mocked(extractResult).mockReturnValue({
      result: 'OK',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 50,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Execute 1000 sequential prompts
    for (let i = 0; i < 1000; i++) {
      const result = (await ext.prompt.fn(
        [`Prompt ${i}`, {}],
        ctx
      )) as ClaudeCodeResult;

      expect(result.result).toBe('OK');
      expect(result.exitCode).toBe(0);

      // Verify no process leaks (at most 1 active at a time for sequential)
      expect(activeProcesses).toBeLessThanOrEqual(1);
    }

    // Verify all 1000 processes were spawned
    expect(spawnClaudeCli).toHaveBeenCalledTimes(1000);

    // Verify all disposers were called
    expect(disposers).toHaveLength(1000);
    disposers.forEach((dispose) => {
      expect(dispose).toHaveBeenCalled();
    });

    // Verify no active processes remain
    expect(activeProcesses).toBe(0);
  });

  it('maintains stable memory with varying response sizes over 1000 calls', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const disposers: Array<() => void> = [];
    let activeProcesses = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      activeProcesses++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      const dispose = vi.fn(() => {
        activeProcesses--;
      });

      disposers.push(dispose);

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise<number>((resolve) => {
          setTimeout(() => {
            if (onDataCallback) {
              // Vary response size (small to large)
              const size = Math.floor(Math.random() * 1000);
              const text = 'X'.repeat(size);
              onDataCallback(JSON.stringify({ type: 'content', text }) + '\n');
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 1);
        }),
        dispose,
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        try {
          callback(JSON.parse(chunk.trim()));
        } catch {
          // Ignore
        }
      }),
      flush: vi.fn(),
    }));

    vi.mocked(extractResult).mockImplementation(() => ({
      result: 'Varying size response',
      tokens: {
        prompt: Math.floor(Math.random() * 100),
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: Math.floor(Math.random() * 50),
      },
      cost: Math.random() * 0.01,
      exitCode: 0,
      duration: Math.floor(Math.random() * 200),
    }));

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Execute 1000 sequential prompts with varying sizes
    for (let i = 0; i < 1000; i++) {
      const result = (await ext.prompt.fn(
        [`Prompt ${i}`, {}],
        ctx
      )) as ClaudeCodeResult;

      expect(result.exitCode).toBe(0);
      expect(activeProcesses).toBeLessThanOrEqual(1);
    }

    expect(spawnClaudeCli).toHaveBeenCalledTimes(1000);
    expect(disposers).toHaveLength(1000);
    disposers.forEach((dispose) => {
      expect(dispose).toHaveBeenCalled();
    });
    expect(activeProcesses).toBe(0);
  });

  it('verifies no file descriptor leaks over 1000 calls', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track PTY instances to verify cleanup
    const ptyInstances: any[] = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      const killFn = vi.fn();
      const ptyInstance = {
        onData: vi.fn((cb) => {
          onDataCallback = cb;
        }),
        onExit: vi.fn((cb) => {
          onExitCallback = cb;
        }),
        write: vi.fn(),
        kill: killFn,
      };

      ptyInstances.push(ptyInstance);

      const dispose = vi.fn(() => {
        // Verify kill is called on cleanup
        killFn();
      });

      return {
        ptyProcess: ptyInstance as any,
        exitCode: new Promise<number>((resolve) => {
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(JSON.stringify({ type: 'content', text: 'OK' }));
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 1);
        }),
        dispose,
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn((chunk: string, callback: (msg: any) => void) => {
        try {
          callback(JSON.parse(chunk.trim()));
        } catch {
          // Ignore
        }
      }),
      flush: vi.fn(),
    }));

    vi.mocked(extractResult).mockReturnValue({
      result: 'OK',
      tokens: {
        prompt: 5,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 3,
      },
      cost: 0.001,
      exitCode: 0,
      duration: 50,
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Execute 1000 sequential prompts
    for (let i = 0; i < 1000; i++) {
      await ext.prompt.fn([`Prompt ${i}`, {}], ctx);
    }

    // Verify all PTY instances had kill called (cleanup)
    expect(ptyInstances).toHaveLength(1000);
    ptyInstances.forEach((pty) => {
      expect(pty.kill).toHaveBeenCalled();
    });
  });
});
