import { createRuntimeContext } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { RESERVED_METHOD_KEYS } from './literal-shape.js';

describe('RESERVED_METHOD_KEYS parity', () => {
  it('matches the dict method names the runtime registers', () => {
    const ctx = createRuntimeContext();
    const dictMethods = Object.keys(ctx.typeMethodDicts.get('dict') ?? {});
    expect([...RESERVED_METHOD_KEYS].sort()).toEqual(dictMethods.sort());
  });
});
