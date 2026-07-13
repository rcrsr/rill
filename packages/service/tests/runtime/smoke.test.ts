/**
 * Rill Language Service Runtime Tests: Smoke Test
 * Verifies the package's own version export and its synchronization with core.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { version as serviceVersion } from '@rcrsr/rill-language-service';
import { VERSION as coreVersion } from '@rcrsr/rill';

// Get package.json path relative to this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');

describe('Rill Language Service: Smoke Test', () => {
  it('exports a defined, non-empty version', () => {
    expect(serviceVersion).toBeDefined();
    expect(serviceVersion.length).toBeGreaterThan(0);
  });

  it('matches package.json version and follows semver shape', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const expectedVersion = packageJson.version as string;

    expect(serviceVersion).toBe(expectedVersion);

    const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    expect(serviceVersion).toMatch(semverPattern);
  });

  it('stays synchronized with the core package version', () => {
    expect(serviceVersion).toBe(coreVersion);
  });
});
