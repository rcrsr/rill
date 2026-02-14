import { describe, it, expect } from 'vitest';
import { CHROMA_EXTENSION_VERSION } from '../src/index.js';

describe('ChromaDB Extension Scaffold', () => {
  it('exports version constant', () => {
    expect(CHROMA_EXTENSION_VERSION).toBe('0.0.1');
  });
});
