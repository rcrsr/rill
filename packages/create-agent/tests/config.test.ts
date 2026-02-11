import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Package Configuration', () => {
  describe('package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf-8')
    );

    it('has correct bin entry pointing to dist/cli.js', () => {
      expect(packageJson.bin).toEqual({
        'rill-create-agent': './dist/cli.js',
      });
    });

    it('package.json type is "module" for ESM support', () => {
      expect(packageJson.type).toBe('module');
    });

    it('handlebars dependency is present', () => {
      expect(packageJson.dependencies).toHaveProperty('handlebars');
      expect(packageJson.dependencies.handlebars).toMatch(/^\^4\.\d+\.\d+$/);
    });

    it('has all required scripts', () => {
      expect(packageJson.scripts).toHaveProperty('build');
      expect(packageJson.scripts).toHaveProperty('test');
      expect(packageJson.scripts).toHaveProperty('typecheck');
      expect(packageJson.scripts).toHaveProperty('lint');
      expect(packageJson.scripts).toHaveProperty('check');
    });

    it('has correct package name', () => {
      expect(packageJson.name).toBe('@rcrsr/rill-create-agent');
    });

    it('includes dist directory in files', () => {
      expect(packageJson.files).toContain('dist');
    });
  });

  describe('tsconfig.json', () => {
    const tsconfigJson = JSON.parse(
      readFileSync(resolve(__dirname, '../tsconfig.json'), 'utf-8')
    );

    it('extends base config and compiles successfully', () => {
      expect(tsconfigJson.extends).toBe('../../tsconfig.base.json');
      expect(tsconfigJson.compilerOptions.rootDir).toBe('./src');
      expect(tsconfigJson.compilerOptions.outDir).toBe('./dist');
    });

    it('does not have project references (standalone package)', () => {
      expect(tsconfigJson.references).toBeUndefined();
    });

    it('includes source files', () => {
      expect(tsconfigJson.include).toEqual(['src/**/*']);
    });
  });
});
