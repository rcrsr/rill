import { describe, it, expect, vi } from 'vitest';
import { execute, createRuntimeContext } from '@rcrsr/rill';

// Mock process module to avoid node-pty dependency
vi.mock('../src/process.js', () => ({
  spawnClaudeCli: vi.fn(),
}));

import { VERSION } from '../src/index.js';

describe('claude-code package', () => {
  describe('package structure', () => {
    it('exports VERSION constant', () => {
      expect(VERSION).toBe('0.1.0');
    });

    it('can import from @rcrsr/rill', () => {
      const ctx = createRuntimeContext();
      expect(ctx).toBeDefined();
      expect(typeof execute).toBe('function');
    });
  });
});
