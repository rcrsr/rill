import { describe, it, expect } from 'vitest';

describe('Package Scaffold', () => {
  describe('package.json', () => {
    it('exports package metadata correctly', async () => {
      const pkg = await import('../package.json', { with: { type: 'json' } });
      expect(pkg.default.name).toBe('@rcrsr/rill-ext-qdrant');
      expect(pkg.default.type).toBe('module');
      expect(pkg.default.dependencies).toHaveProperty('@qdrant/js-client-rest');
      expect(pkg.default.peerDependencies).toHaveProperty('@rcrsr/rill');
      expect(pkg.default.devDependencies).toHaveProperty('@rcrsr/rill');
    });
  });

  describe('TypeScript configuration', () => {
    it('extends parent tsconfig correctly', async () => {
      const tsconfig = await import('../tsconfig.json', {
        with: { type: 'json' },
      });
      expect(tsconfig.default.extends).toBe('../tsconfig.ext.json');
      expect(tsconfig.default.compilerOptions.rootDir).toBe('./src');
      expect(tsconfig.default.compilerOptions.outDir).toBe('./dist');
      expect(tsconfig.default.references).toEqual([{ path: '../../core' }]);
    });
  });

  describe('Vitest configuration', () => {
    it('resolves @rcrsr/rill alias correctly', async () => {
      const config = await import('../vitest.config.ts');
      expect(config.default.resolve?.alias).toBeDefined();
      expect(config.default.resolve?.alias?.['@rcrsr/rill']).toContain(
        'core/src/index.ts'
      );
    });
  });
});
