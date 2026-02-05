/**
 * PR Check Workflow Verification
 * Tests for IC-12: .github/workflows/pr-check.yml configuration
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT_DIR = join(__dirname, '..', '..');
const WORKFLOW_FILE = join(ROOT_DIR, '.github', 'workflows', 'pr-check.yml');

describe('PR Check Workflow', () => {
  describe('workflow file', () => {
    it('exists at .github/workflows/pr-check.yml', () => {
      expect(existsSync(WORKFLOW_FILE)).toBe(true);
    });

    it('contains valid YAML', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      expect(() => parseYaml(content)).not.toThrow();
    });
  });

  describe('IC-12: pnpm configuration', () => {
    it('uses pnpm install --frozen-lockfile instead of npm ci', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      expect(content).toContain('pnpm install --frozen-lockfile');
      expect(content).not.toContain('npm ci');
    });

    it('uses pnpm -r run check instead of npm run check', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      expect(content).toContain('pnpm -r run check');
      expect(content).not.toContain('npm run check');
    });

    it('includes Corepack setup step', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.check?.steps;
      expect(steps).toBeDefined();

      const corepackStep = steps?.find((step: any) =>
        step.run?.includes('corepack enable')
      );

      expect(corepackStep).toBeDefined();
    });

    it('sets up pnpm cache with actions/setup-node', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.check?.steps;
      const setupNodeStep = steps?.find((step: any) =>
        step.uses?.startsWith('actions/setup-node@')
      );

      expect(setupNodeStep).toBeDefined();
      expect(setupNodeStep?.with?.cache).toBe('pnpm');
    });
  });

  describe('EC-6: frozen lockfile detection', () => {
    it('uses --frozen-lockfile flag to detect out-of-sync changes', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      // Frozen lockfile flag prevents install if lockfile is out of sync
      expect(content).toContain('--frozen-lockfile');
    });
  });

  describe('workflow structure', () => {
    it('triggers on pull request events', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      expect(workflow?.on?.pull_request).toBeDefined();
    });

    it('runs on ubuntu-latest', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      expect(workflow?.jobs?.check?.['runs-on']).toBe('ubuntu-latest');
    });

    it('uses Node.js 20', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.check?.steps;
      const setupNodeStep = steps?.find((step: any) =>
        step.uses?.startsWith('actions/setup-node@')
      );

      expect(setupNodeStep?.with?.['node-version']).toBe('20');
    });
  });
});
