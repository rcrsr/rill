/**
 * Integration tests for Claude Code extension success cases.
 * Tests extension factory and result structure with mocked stream parser and result extractor.
 */

import { describe, it, expect, vi } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { createRuntimeContext } from '@rcrsr/rill';
import type { ClaudeCodeResult } from '../src/types.js';

// Mock which module
vi.mock('which', () => ({
  default: {
    sync: vi.fn(() => 'claude'),
  },
}));

// Mock node-pty to avoid native module loading
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock the entire process and result extraction stack
vi.mock('../src/process.js');
vi.mock('../src/stream-parser.js');
vi.mock('../src/result.js');

describe('Claude Code Extension Integration Tests - Success Cases', () => {
  describe('AC-1: Basic prompt returns result dict with text, tokens, cost, exitCode 0', () => {
    it('returns complete ClaudeCodeResult structure', async () => {
      // Import mocked modules
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      // Setup mocks
      const mockParser = {
        processChunk: vi.fn(),
        flush: vi.fn(),
      };

      vi.mocked(createStreamParser).mockReturnValue(mockParser);

      vi.mocked(extractResult).mockReturnValue({
        result: 'Hello! How can I help?',
        tokens: {
          prompt: 10,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 8,
        },
        cost: 0.001,
        exitCode: 0,
        duration: 1200,
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

      // Create extension and execute
      const ext = createClaudeCodeExtension();
      const ctx = createRuntimeContext();

      const result = (await ext.prompt.fn(
        ['Hello Claude', {}],
        ctx
      )) as ClaudeCodeResult;

      // Verify result structure (AC-1)
      expect(result.result).toBe('Hello! How can I help?');
      expect(result.tokens.prompt).toBe(10);
      expect(result.tokens.output).toBe(8);
      expect(result.cost).toBe(0.001);
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBe(1200);
    });
  });

  describe('AC-2: Skill with args passes serialized flags, returns result', () => {
    it('serializes boolean and nested dict args correctly', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Skill executed',
        tokens: {
          prompt: 15,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 5,
        },
        cost: 0.002,
        exitCode: 0,
        duration: 800,
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

      const result = await ext.skill.fn(
        [
          'test-skill',
          {
            verbose: true,
            config: { level: 'debug', output: 'json' },
            retries: 3,
          },
        ],
        ctx
      );

      // Verify spawn was called with serialized args (AC-2)
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        '/test-skill --verbose --config.level debug --config.output json --retries 3',
        expect.objectContaining({ binaryPath: 'claude' })
      );

      expect(result).toMatchObject({
        result: 'Skill executed',
        exitCode: 0,
      });
    });
  });

  describe('AC-3: Custom timeout respects timeout option value', () => {
    it('propagates custom timeout to process manager', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

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

      await ext.prompt.fn(['Test prompt', { timeout: 60000 }], ctx);

      // Verify custom timeout was passed (AC-3)
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 60000 })
      );
    });

    it('uses default timeout when option not provided', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

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

      // Verify default timeout was used
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 45000 })
      );
    });
  });

  describe('AC-4: Token tracking extracts full breakdown from usage events', () => {
    it('returns 5-field token breakdown from extractResult', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock extractResult with all 5 token fields (AC-4)
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 20,
          cacheWrite5m: 5,
          cacheWrite1h: 8,
          cacheRead: 3,
          output: 10,
        },
        cost: 0.002,
        exitCode: 0,
        duration: 1000,
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

      const result = (await ext.prompt.fn(
        ['Test', {}],
        ctx
      )) as ClaudeCodeResult;

      // Verify all 5 token fields present
      expect(result.tokens.prompt).toBe(20);
      expect(result.tokens.cacheWrite5m).toBe(5);
      expect(result.tokens.cacheWrite1h).toBe(8);
      expect(result.tokens.cacheRead).toBe(3);
      expect(result.tokens.output).toBe(10);
    });
  });

  describe('AC-5: Cost extraction reads cost_usd from CLI ResultMessage', () => {
    it('extracts cost field from result', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with specific cost value (AC-5)
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 3,
        },
        cost: 0.00456,
        exitCode: 0,
        duration: 800,
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

      const result = (await ext.prompt.fn(
        ['Test', {}],
        ctx
      )) as ClaudeCodeResult;

      // Verify exact cost extraction
      expect(result.cost).toBe(0.00456);
    });
  });

  describe('AC-12: Empty result returns empty string in result field', () => {
    it('returns empty string when extractResult provides empty text', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with empty result string (AC-12)
      vi.mocked(extractResult).mockReturnValue({
        result: '',
        tokens: {
          prompt: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 0,
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

      const result = (await ext.prompt.fn(
        ['Test', {}],
        ctx
      )) as ClaudeCodeResult;

      // Verify empty string
      expect(result.result).toBe('');
    });
  });

  describe('AC-13: Zero tokens returns all-zero TokenCounts', () => {
    it('returns zero values for all token fields', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with all-zero tokens (AC-13)
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          output: 0,
        },
        cost: 0.0,
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

      const result = (await ext.prompt.fn(
        ['Test', {}],
        ctx
      )) as ClaudeCodeResult;

      // Verify all zeros
      expect(result.tokens.prompt).toBe(0);
      expect(result.tokens.cacheWrite5m).toBe(0);
      expect(result.tokens.cacheWrite1h).toBe(0);
      expect(result.tokens.cacheRead).toBe(0);
      expect(result.tokens.output).toBe(0);
    });
  });
});
