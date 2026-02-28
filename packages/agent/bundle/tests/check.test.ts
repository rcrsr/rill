import { describe, it, expect, afterEach } from 'vitest';
import { rm, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPlatform } from '../src/check.js';
import { ComposeError } from '@rcrsr/rill-agent-shared';

// ============================================================
// MINIMAL BUNDLE.JSON FIXTURE
// ============================================================

const MINIMAL_BUNDLE_MANIFEST = {
  name: 'test-bundle',
  version: '0.1.0',
  built: '2026-01-01T00:00:00.000Z',
  checksum: 'sha256:abc123',
  rillVersion: '0.8.6',
  agents: {
    'test-agent': {
      entry: 'entry.rill',
      modules: {},
      extensions: {},
      card: {
        name: 'test-agent',
        description: '',
        version: '0.1.0',
        url: '',
        capabilities: { streaming: false, pushNotifications: false },
        skills: [],
        defaultInputModes: ['application/json'],
        defaultOutputModes: ['application/json'],
      },
    },
  },
};

// ============================================================
// TEMP DIR HELPERS
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-check-test-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Creates a temp dir with a valid bundle.json and returns the dir path.
 */
async function makeBundleDir(
  overrides: Partial<typeof MINIMAL_BUNDLE_MANIFEST> = {}
): Promise<string> {
  const dir = await makeTmpDir();
  const manifest = { ...MINIMAL_BUNDLE_MANIFEST, ...overrides };
  await writeFile(
    path.join(dir, 'bundle.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// AC-28: checkPlatform returns PlatformCheckResult
// ============================================================

describe('checkPlatform success cases', () => {
  // ----------------------------------------------------------
  // AC-28: node platform returns compatible result with issues array
  // ----------------------------------------------------------
  it('returns PlatformCheckResult with compatible and issues properties [AC-28]', async () => {
    const bundleDir = await makeBundleDir();

    const result = await checkPlatform(bundleDir, 'node');

    expect(typeof result.compatible).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
  });

  // ----------------------------------------------------------
  // Additional: node platform always returns compatible: true, issues: []
  // ----------------------------------------------------------
  it('node platform returns compatible: true with empty issues array', async () => {
    const bundleDir = await makeBundleDir();

    const result = await checkPlatform(bundleDir, 'node');

    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
  });

  // ----------------------------------------------------------
  // Additional: worker platform on bundle with no extensions returns compatible
  // ----------------------------------------------------------
  it('worker platform with no extensions returns compatible result', async () => {
    const bundleDir = await makeBundleDir();

    const result = await checkPlatform(bundleDir, 'worker');

    expect(typeof result.compatible).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
    // No extensions means no native addon or built-in issues
    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('checkPlatform error cases', () => {
  // ----------------------------------------------------------
  // EC-16: bundle.json missing → ComposeError phase 'validation'
  // ----------------------------------------------------------
  it('throws ComposeError phase validation when bundle.json is missing [EC-16]', async () => {
    const emptyDir = await makeTmpDir();

    await expect(checkPlatform(emptyDir, 'node')).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof ComposeError &&
          e.phase === 'validation' &&
          e.message.includes(emptyDir)
        );
      }
    );
  });

  // ----------------------------------------------------------
  // EC-17: Invalid bundle.json → ComposeError phase 'validation'
  // ----------------------------------------------------------
  it('throws ComposeError phase validation when bundle.json contains invalid JSON [EC-17]', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'bundle.json'),
      '{ not valid json }',
      'utf-8'
    );

    await expect(checkPlatform(dir, 'node')).rejects.toSatisfy((e: unknown) => {
      return e instanceof ComposeError && e.phase === 'validation';
    });
  });

  it('throws ComposeError phase validation when bundle.json is missing required fields [EC-17]', async () => {
    const dir = await makeTmpDir();
    await writeFile(
      path.join(dir, 'bundle.json'),
      JSON.stringify({ name: 'incomplete-bundle' }),
      'utf-8'
    );

    await expect(checkPlatform(dir, 'node')).rejects.toSatisfy((e: unknown) => {
      return e instanceof ComposeError && e.phase === 'validation';
    });
  });

  // ----------------------------------------------------------
  // AC-36: Unknown platform → ComposeError phase 'validation'
  // ----------------------------------------------------------
  it('throws ComposeError phase validation for unknown platform [AC-36]', async () => {
    const bundleDir = await makeBundleDir();

    await expect(
      checkPlatform(bundleDir, 'invalid-platform')
    ).rejects.toSatisfy((e: unknown) => {
      return (
        e instanceof ComposeError &&
        e.phase === 'validation' &&
        e.message.includes('invalid-platform')
      );
    });
  });

  it('throws ComposeError listing valid platforms for unknown platform [AC-36]', async () => {
    const bundleDir = await makeBundleDir();

    await expect(
      checkPlatform(bundleDir, 'invalid-platform')
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof ComposeError)) return false;
      // Error message should list valid platforms
      return (
        e.message.includes('node') ||
        e.message.includes('worker') ||
        e.message.includes('lambda')
      );
    });
  });
});
