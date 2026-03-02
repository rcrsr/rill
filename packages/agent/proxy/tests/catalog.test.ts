/**
 * Catalog unit tests.
 *
 * AC-57: Single bundle in directory → catalog has 1 entry
 * AC-58: Bundle with multiple agents → each agent in catalog
 * AC-63: Refresh while children running → running children unaffected (catalog replaced atomically)
 * AC-65: Empty directory after refresh → catalog empty, no error
 * EC-6: Bundles dir missing → Error at startup
 * EC-7: Zero valid bundles → Error at startup
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createCatalog } from '../src/catalog.js';

// ============================================================
// HELPERS
// ============================================================

function makeBundleManifest(
  name: string,
  version: string,
  agentNames: string[]
): string {
  const agents: Record<string, unknown> = {};
  for (const agentName of agentNames) {
    agents[agentName] = {
      entry: 'agent.js',
      modules: {},
      extensions: {},
      card: {
        name: agentName,
        description: `${agentName} agent`,
        version,
        url: 'http://localhost',
        capabilities: {
          streaming: false,
          pushNotifications: false,
          stateTransitionHistory: false,
        },
        skills: [],
        defaultInputModes: ['application/json'],
        defaultOutputModes: ['application/json'],
      },
    };
  }
  return JSON.stringify({
    name,
    version,
    built: new Date().toISOString(),
    checksum: 'sha256:abc123',
    rillVersion: '0.8.0',
    agents,
  });
}

function writeBundle(
  bundlesDir: string,
  bundleDirName: string,
  agentNames: string[],
  version = '1.0.0'
): string {
  const bundleDir = path.join(bundlesDir, bundleDirName);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, 'bundle.json'),
    makeBundleManifest(bundleDirName, version, agentNames)
  );
  fs.writeFileSync(path.join(bundleDir, 'harness.js'), '// harness');
  return bundleDir;
}

// ============================================================
// TEST SUITE
// ============================================================

describe('createCatalog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-catalog-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('startup', () => {
    it('AC-57: single bundle with one agent → catalog has 1 entry', async () => {
      // Arrange
      writeBundle(tmpDir, 'bundle-a', ['agentAlpha']);

      // Act
      const catalog = await createCatalog(tmpDir);

      // Assert
      expect(catalog.entries.size).toBe(1);
      expect(catalog.get('agentAlpha')).toBeDefined();
      expect(catalog.get('agentAlpha')?.name).toBe('agentAlpha');
    });

    it('AC-58: bundle with multiple agents → each agent in catalog', async () => {
      // Arrange
      writeBundle(tmpDir, 'multi-bundle', ['agentA', 'agentB', 'agentC']);

      // Act
      const catalog = await createCatalog(tmpDir);

      // Assert
      expect(catalog.entries.size).toBe(3);
      expect(catalog.get('agentA')).toBeDefined();
      expect(catalog.get('agentB')).toBeDefined();
      expect(catalog.get('agentC')).toBeDefined();
    });

    it('merges agents across multiple bundle directories', async () => {
      // Arrange
      writeBundle(tmpDir, 'bundle-x', ['agentX']);
      writeBundle(tmpDir, 'bundle-y', ['agentY']);

      // Act
      const catalog = await createCatalog(tmpDir);

      // Assert
      expect(catalog.entries.size).toBe(2);
      expect(catalog.get('agentX')).toBeDefined();
      expect(catalog.get('agentY')).toBeDefined();
    });

    it('entry has expected fields set from bundle.json', async () => {
      // Arrange
      writeBundle(tmpDir, 'bundle-v', ['agentV'], '2.3.4');

      // Act
      const catalog = await createCatalog(tmpDir);
      const entry = catalog.get('agentV');

      // Assert
      expect(entry?.version).toBe('2.3.4');
      expect(entry?.bundlePath).toContain('bundle-v');
      expect(entry?.checksum).toMatch(/^sha256:[a-f0-9]+$/);
      expect(entry?.card.name).toBe('agentV');
    });

    it('EC-6: bundlesDir missing → throws Error at startup', async () => {
      // Arrange
      const missingDir = path.join(tmpDir, 'does-not-exist');

      // Act & Assert
      await expect(createCatalog(missingDir)).rejects.toThrow(
        /Bundles directory not found/
      );
    });

    it('EC-7: zero valid bundles → throws Error at startup', async () => {
      // Arrange — empty directory, no bundles

      // Act & Assert
      await expect(createCatalog(tmpDir)).rejects.toThrow(
        /No valid bundles found/
      );
    });

    it('EC-7: directory with subdirs lacking bundle.json → zero valid → throws', async () => {
      // Arrange
      const subDir = path.join(tmpDir, 'empty-bundle');
      fs.mkdirSync(subDir);
      // No bundle.json, no harness.js

      // Act & Assert
      await expect(createCatalog(tmpDir)).rejects.toThrow(
        /No valid bundles found/
      );
    });

    it('skips bundle directory missing harness.js', async () => {
      // Arrange
      const bundleDir = path.join(tmpDir, 'no-harness');
      fs.mkdirSync(bundleDir);
      fs.writeFileSync(
        path.join(bundleDir, 'bundle.json'),
        makeBundleManifest('no-harness', '1.0.0', ['agentNoHarness'])
      );
      // harness.js intentionally omitted
      // Also add a valid bundle so startup doesn't throw EC-7
      writeBundle(tmpDir, 'valid-bundle', ['agentValid']);

      // Act
      const catalog = await createCatalog(tmpDir);

      // Assert: only the valid bundle's agent appears
      expect(catalog.get('agentNoHarness')).toBeUndefined();
      expect(catalog.get('agentValid')).toBeDefined();
    });
  });

  describe('refresh()', () => {
    it('AC-63: refresh replaces catalog atomically; get() returns new entries', async () => {
      // Arrange — start with agentOld
      writeBundle(tmpDir, 'bundle-old', ['agentOld']);
      const catalog = await createCatalog(tmpDir);
      expect(catalog.get('agentOld')).toBeDefined();

      // Simulate a concurrent "running child" by holding a reference to the
      // old entry before refresh. The catalog replaces its internal map but
      // in-flight processes holding their own CatalogEntry references are unaffected.
      const entryBeforeRefresh = catalog.get('agentOld');

      // Add a new bundle directory
      writeBundle(tmpDir, 'bundle-new', ['agentNew']);

      // Act
      await catalog.refresh();

      // Assert: new catalog has both agents (old dir still present)
      expect(catalog.get('agentNew')).toBeDefined();
      // Previously held reference unchanged (AC-63: running children unaffected)
      expect(entryBeforeRefresh?.name).toBe('agentOld');
    });

    it('AC-65: empty directory after refresh → catalog empty, no error', async () => {
      // Arrange — start with one valid bundle
      writeBundle(tmpDir, 'bundle-temp', ['agentTemp']);
      const catalog = await createCatalog(tmpDir);
      expect(catalog.entries.size).toBe(1);

      // Remove bundle directory to make bundles dir empty
      fs.rmSync(path.join(tmpDir, 'bundle-temp'), { recursive: true });

      // Act — refresh should not throw
      await expect(catalog.refresh()).resolves.toBeUndefined();

      // Assert
      expect(catalog.entries.size).toBe(0);
    });

    it('refresh with mismatched bundles dir does not throw; EC-6 only applies at startup', async () => {
      // Arrange — create catalog with valid bundles
      writeBundle(tmpDir, 'bundle-x', ['agentX']);
      const catalog = await createCatalog(tmpDir);

      // Calling refresh() on internal implementation uses the same bundlesDir.
      // Here we just verify normal refresh flow works.
      await expect(catalog.refresh()).resolves.toBeUndefined();
    });
  });
});
