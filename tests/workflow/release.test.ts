/**
 * Release Workflow Verification
 * Tests for IC-13: .github/workflows/release.yml configuration
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT_DIR = join(__dirname, '..', '..');
const WORKFLOW_FILE = join(ROOT_DIR, '.github', 'workflows', 'release.yml');

describe('Release Workflow', () => {
  describe('workflow file', () => {
    it('exists at .github/workflows/release.yml', () => {
      expect(existsSync(WORKFLOW_FILE)).toBe(true);
    });

    it('contains valid YAML', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      expect(() => parseYaml(content)).not.toThrow();
    });
  });

  describe('IC-13: manual trigger', () => {
    it('uses workflow_dispatch trigger', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      expect(workflow?.on).toBeDefined();
      expect(workflow?.on?.workflow_dispatch).toBeDefined();
    });

    it('does not trigger automatically on push or pull request', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      // Ensure it's manual-only (no automatic triggers)
      expect(workflow?.on?.push).toBeUndefined();
      expect(workflow?.on?.pull_request).toBeUndefined();
    });
  });

  describe('IC-13: build and test', () => {
    it('builds all packages before publishing', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps;
      expect(steps).toBeDefined();

      const buildStep = steps?.find(
        (step: any) =>
          step.name?.includes('Build') ||
          step.run?.includes('pnpm -r run build')
      );

      expect(buildStep).toBeDefined();
      expect(buildStep?.run).toContain('pnpm -r run build');
    });

    it('runs tests before publishing', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps;
      expect(steps).toBeDefined();

      const testStep = steps?.find(
        (step: any) =>
          step.name?.includes('test') || step.run?.includes('pnpm -r run test')
      );

      expect(testStep).toBeDefined();
      expect(testStep?.run).toContain('pnpm -r run test');
    });

    it('runs build and test steps before publish steps', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps || [];

      const buildStepIndex = steps.findIndex((step: any) =>
        step.run?.includes('pnpm -r run build')
      );
      const testStepIndex = steps.findIndex((step: any) =>
        step.run?.includes('pnpm -r run test')
      );
      const publishStepIndex = steps.findIndex((step: any) =>
        step.run?.includes('npm publish')
      );

      expect(buildStepIndex).toBeGreaterThanOrEqual(0);
      expect(testStepIndex).toBeGreaterThanOrEqual(0);
      expect(publishStepIndex).toBeGreaterThanOrEqual(0);

      // Build and test must come before publish
      expect(buildStepIndex).toBeLessThan(publishStepIndex);
      expect(testStepIndex).toBeLessThan(publishStepIndex);
    });
  });

  describe('IC-13: npm publishing', () => {
    it('uses OIDC trusted publishing instead of npm tokens', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      // No static NPM_TOKEN — OIDC handles authentication
      expect(content).not.toContain('NPM_TOKEN');
      expect(content).not.toContain('NODE_AUTH_TOKEN');
    });

    it('omits --provenance flag (automatic with OIDC)', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      // Provenance is generated automatically via trusted publishing
      expect(content).not.toContain('--provenance');
    });

    it('publishes all three packages', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps || [];
      const publishSteps = steps.filter((step: any) =>
        step.run?.includes('npm publish')
      );

      expect(publishSteps.length).toBe(3);

      const packageDirs = publishSteps.map(
        (step: any) => step['working-directory']
      );
      expect(packageDirs).toContain('packages/core');
      expect(packageDirs).toContain('packages/cli');
      expect(packageDirs).toContain('packages/ext/claude-code');
    });

    it('does not set env on publish steps (OIDC provides credentials)', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps || [];
      const publishSteps = steps.filter((step: any) =>
        step.run?.includes('npm publish')
      );

      publishSteps.forEach((step: any) => {
        expect(step.env).toBeUndefined();
      });
    });
  });

  describe('AC-9: git tags', () => {
    it('creates git tags with package@version format', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      // Should tag each package with @rcrsr/package@version format
      expect(content).toContain('@rcrsr/rill@');
      expect(content).toContain('@rcrsr/rill-cli@');
      expect(content).toContain('@rcrsr/rill-ext-claude-code@');
    });

    it('reads version from package.json for each tag', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      // Should extract version from package.json files
      expect(content).toContain(
        "require('./packages/core/package.json').version"
      );
      expect(content).toContain(
        "require('./packages/cli/package.json').version"
      );
      expect(content).toContain(
        "require('./packages/ext/claude-code/package.json').version"
      );
    });

    it('pushes tags to remote', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      expect(content).toContain('git push --tags');
    });

    it('creates annotated tags with messages', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      // Should use -a flag for annotated tags with -m for messages
      const tagCommands = content.match(/git tag -a[^\n]*/g);
      expect(tagCommands).toBeDefined();
      expect(tagCommands!.length).toBe(3);

      tagCommands!.forEach((cmd) => {
        expect(cmd).toContain('-a');
        expect(cmd).toContain('-m');
      });
    });
  });

  describe('workflow permissions', () => {
    it('has id-token write permission for OIDC trusted publishing', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      expect(workflow?.jobs?.release?.permissions).toBeDefined();
      expect(workflow?.jobs?.release?.permissions?.['id-token']).toBe('write');
    });

    it('has contents write permission for git tags', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      expect(workflow?.jobs?.release?.permissions).toBeDefined();
      expect(workflow?.jobs?.release?.permissions?.contents).toBe('write');
    });
  });

  describe('workflow setup', () => {
    it('uses ubuntu-latest', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      expect(workflow?.jobs?.release?.['runs-on']).toBe('ubuntu-latest');
    });

    it('uses Node.js 24 (required for npm CLI >= 11.5.1)', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps;
      const setupNodeStep = steps?.find((step: any) =>
        step.uses?.startsWith('actions/setup-node@')
      );

      expect(setupNodeStep?.with?.['node-version']).toBe('24');
    });

    it('configures npm registry', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps;
      const setupNodeStep = steps?.find((step: any) =>
        step.uses?.startsWith('actions/setup-node@')
      );

      expect(setupNodeStep?.with?.['registry-url']).toBe(
        'https://registry.npmjs.org'
      );
    });

    it('enables Corepack for pnpm', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');
      const workflow = parseYaml(content);

      const steps = workflow?.jobs?.release?.steps;
      const corepackStep = steps?.find((step: any) =>
        step.run?.includes('corepack enable')
      );

      expect(corepackStep).toBeDefined();
    });

    it('installs dependencies with frozen lockfile', () => {
      const content = readFileSync(WORKFLOW_FILE, 'utf-8');

      expect(content).toContain('pnpm install --frozen-lockfile');
    });
  });
});
