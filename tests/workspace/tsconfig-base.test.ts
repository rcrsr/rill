/**
 * Verification tests for tsconfig.base.json creation (IC-3)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(__dirname, '../..');

/**
 * Parse JSON with comments (JSONC)
 */
function parseJsonc(content: string): unknown {
  // Strip single-line comments
  const withoutSingleLine = content.replace(/\/\/.*$/gm, '');
  // Strip multi-line comments
  const withoutMultiLine = withoutSingleLine.replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(withoutMultiLine);
}

describe('tsconfig.base.json', () => {
  it('exists at root', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    expect(existsSync(baseConfigPath)).toBe(true);
  });

  it('has shared compiler options', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    const content = parseJsonc(readFileSync(baseConfigPath, 'utf-8'));

    expect(content.compilerOptions).toBeDefined();
    expect(content.compilerOptions.target).toBe('ES2022');
    expect(content.compilerOptions.module).toBe('NodeNext');
    expect(content.compilerOptions.strict).toBe(true);
  });

  it('has composite:true for project references', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    const content = parseJsonc(readFileSync(baseConfigPath, 'utf-8'));

    expect(content.compilerOptions.composite).toBe(true);
  });

  it('excludes rootDir and outDir (package-specific)', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    const content = parseJsonc(readFileSync(baseConfigPath, 'utf-8'));

    expect(content.compilerOptions.rootDir).toBeUndefined();
    expect(content.compilerOptions.outDir).toBeUndefined();
  });

  it('has essential strict type checking options', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    const content = parseJsonc(readFileSync(baseConfigPath, 'utf-8'));

    expect(content.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(content.compilerOptions.exactOptionalPropertyTypes).toBe(true);
  });

  it('has module handling options', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    const content = parseJsonc(readFileSync(baseConfigPath, 'utf-8'));

    expect(content.compilerOptions.esModuleInterop).toBe(true);
    expect(content.compilerOptions.isolatedModules).toBe(true);
    expect(content.compilerOptions.verbatimModuleSyntax).toBe(true);
  });

  it('has code quality options', () => {
    const baseConfigPath = resolve(rootDir, 'tsconfig.base.json');
    const content = parseJsonc(readFileSync(baseConfigPath, 'utf-8'));

    expect(content.compilerOptions.noUnusedLocals).toBe(true);
    expect(content.compilerOptions.noUnusedParameters).toBe(true);
    expect(content.compilerOptions.noImplicitReturns).toBe(true);
  });
});

describe('root tsconfig.json', () => {
  it('extends tsconfig.base.json', () => {
    const rootConfigPath = resolve(rootDir, 'tsconfig.json');
    const content = parseJsonc(readFileSync(rootConfigPath, 'utf-8'));

    expect(content.extends).toBe('./tsconfig.base.json');
  });

  it('has package-specific rootDir and outDir', () => {
    const rootConfigPath = resolve(rootDir, 'tsconfig.json');
    const content = parseJsonc(readFileSync(rootConfigPath, 'utf-8'));

    expect(content.compilerOptions.rootDir).toBe('./src');
    expect(content.compilerOptions.outDir).toBe('./dist');
  });

  it('inherits compiler options from base (implicit test via TypeScript)', () => {
    // This is implicitly tested by the successful build and test runs
    // If the extension wasn't working, TypeScript would fail to compile
    const rootConfigPath = resolve(rootDir, 'tsconfig.json');
    const content = parseJsonc(readFileSync(rootConfigPath, 'utf-8'));

    // Verify that options NOT in the root config would be inherited from base
    expect(content.compilerOptions.strict).toBeUndefined(); // Should be inherited
    expect(content.compilerOptions.composite).toBeUndefined(); // Should be inherited
  });
});
