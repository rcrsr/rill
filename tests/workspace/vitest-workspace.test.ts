/**
 * Vitest Workspace Configuration Verification
 * Tests for IC-4: vitest.workspace.ts creation
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '../..');
const VITEST_WORKSPACE_FILE = join(ROOT_DIR, 'vitest.workspace.ts');

describe('Vitest Workspace Configuration (IC-4)', () => {
  describe('file existence', () => {
    it('vitest.workspace.ts exists at root', () => {
      expect(existsSync(VITEST_WORKSPACE_FILE)).toBe(true);
    });
  });

  describe('file structure', () => {
    it('contains TypeScript module export', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain('export default');
      expect(content).toContain('defineWorkspace');
    });

    it('imports defineWorkspace from vitest/config', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain(
        "import { defineWorkspace } from 'vitest/config'"
      );
    });
  });

  describe('workspace project definitions', () => {
    it('defines root project for current tests', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain("name: 'root'");
      expect(content).toContain("include: ['tests/**/*.test.ts']");
    });

    it('defines core package project', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain("name: 'core'");
      expect(content).toContain(
        "include: ['packages/core/tests/**/*.test.ts']"
      );
    });

    it('defines cli package project', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain("name: 'cli'");
      expect(content).toContain("include: ['packages/cli/tests/**/*.test.ts']");
    });

    it('defines extension packages project', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain("name: 'ext'");
      expect(content).toContain(
        "include: ['packages/ext/*/tests/**/*.test.ts']"
      );
    });
  });

  describe('shared globals configuration', () => {
    it('enables globals for all projects', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      // Count occurrences of 'globals: true'
      const matches = content.match(/globals:\s*true/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(4); // At least 4 projects
    });

    it('sets node environment for all projects', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      // Count occurrences of 'environment: 'node''
      const matches = content.match(/environment:\s*['"]node['"]/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(4); // At least 4 projects
    });
  });

  describe('coverage configuration', () => {
    it('configures v8 coverage provider for all projects', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      const matches = content.match(/provider:\s*['"]v8['"]/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(4);
    });

    it('configures coverage reporters for all projects', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      expect(content).toContain("reporter: ['text', 'html', 'lcov']");
    });
  });

  describe('independent package test execution', () => {
    it('each package has isolated test configuration', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');

      // Each package should have its own name and include pattern
      expect(content).toContain("name: 'core'");
      expect(content).toContain("name: 'cli'");
      expect(content).toContain("name: 'ext'");

      // Each package should have distinct include paths
      expect(content).toContain(
        "include: ['packages/core/tests/**/*.test.ts']"
      );
      expect(content).toContain("include: ['packages/cli/tests/**/*.test.ts']");
      expect(content).toContain(
        "include: ['packages/ext/*/tests/**/*.test.ts']"
      );
    });

    it('each package has isolated coverage configuration', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');

      // Each package should have its own coverage include path
      expect(content).toContain("include: ['packages/core/src/**/*.ts']");
      expect(content).toContain("include: ['packages/cli/src/**/*.ts']");
      expect(content).toContain("include: ['packages/ext/*/src/**/*.ts']");
    });
  });

  describe('TypeScript configuration inheritance', () => {
    it('extends tsconfig.base.json for package projects', () => {
      const content = readFileSync(VITEST_WORKSPACE_FILE, 'utf-8');
      const matches = content.match(
        /extends:\s*['"]\.\/tsconfig\.base\.json['"]/g
      );
      expect(matches).toBeTruthy();
      expect(matches!.length).toBeGreaterThanOrEqual(3); // core, cli, ext packages
    });
  });
});
