/**
 * Release Script Validation Tests
 * Unit tests for EC-7: Publish without --access public
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/release.sh');

describe('EC-7: Publish without --access public → npm rejects', () => {
  it('validates publishConfig.access before publish', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Script must check for publishConfig.access
    expect(content).toMatch(/publishConfig\.access/);
    expect(content).toContain('"access": "public"');
  });

  it('errors if publishConfig.access missing', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Script must error if access setting is missing
    expect(content).toMatch(/error.*publishConfig\.access.*public/is);
  });

  it('verifies all packages before attempting any publish', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Find verification section
    const verifyIndex = content.indexOf('Verifying publish configuration');
    const firstPublishIndex = content.indexOf('pnpm publish');

    expect(verifyIndex).toBeGreaterThan(0);
    expect(verifyIndex).toBeLessThan(firstPublishIndex);
  });

  it('prevents publish if any package missing access setting', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Script should loop through packages and check each one
    expect(content).toMatch(/for pkg in.*PACKAGES/);
    expect(content).toMatch(/grep.*access.*public/);
    expect(content).toMatch(/error.*missing publishConfig/i);
  });

  it('uses pnpm publish --access public explicitly', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Even though publishConfig exists, we enforce --access public flag
    expect(content).toContain('pnpm publish --access public');
  });

  it('includes comment about ERR_NPM_PACKAGE_PRIVATE error', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Script should document why --access public is needed
    // (publishConfig.access is used automatically, but we verify it exists)
    expect(content).toMatch(/publishConfig\.access.*automatically/i);
  });
});

describe('AC-13: Publish without --access public → npm rejects', () => {
  it('enforces --access public requirement', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf-8');

    // Count all pnpm publish commands - all must have --access public
    const publishMatches = content.match(/pnpm publish/g);
    const publishWithAccessMatches = content.match(
      /pnpm publish --access public/g
    );

    expect(publishMatches).toBeTruthy();
    expect(publishWithAccessMatches).toBeTruthy();
    expect(publishWithAccessMatches!.length).toBe(publishMatches!.length);
  });
});
