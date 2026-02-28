import { describe, it, expect, afterEach } from 'vitest';
import { rm, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBundle } from '../src/build.js';
import {
  ComposeError,
  ManifestValidationError,
} from '@rcrsr/rill-agent-shared';

// ============================================================
// MINIMAL FIXTURE
// ============================================================

const MINIMAL_AGENT_MANIFEST = {
  name: 'test-agent',
  version: '0.1.0',
  runtime: '@rcrsr/rill@*',
  entry: 'main.rill',
  extensions: {},
  modules: {},
  functions: {},
  assets: [],
  skills: [],
};

const MINIMAL_RILL_SCRIPT = `"hello world"`;

// ============================================================
// TEMP DIR HELPERS
// ============================================================

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rill-bundle-test-'));
  tmpDirs.push(dir);
  return dir;
}

/**
 * Create a minimal agent fixture in a temp directory.
 * Returns the manifest path and the output dir path.
 */
async function makeAgentFixture(
  overrides: Partial<typeof MINIMAL_AGENT_MANIFEST> = {}
): Promise<{ manifestPath: string; outputDir: string; fixtureDir: string }> {
  const fixtureDir = await makeTmpDir();
  const outputDir = await makeTmpDir();

  const manifest = { ...MINIMAL_AGENT_MANIFEST, ...overrides };
  await writeFile(
    path.join(fixtureDir, 'agent.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  await writeFile(
    path.join(fixtureDir, 'main.rill'),
    MINIMAL_RILL_SCRIPT,
    'utf-8'
  );

  return {
    manifestPath: path.join(fixtureDir, 'agent.json'),
    outputDir,
    fixtureDir,
  };
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ============================================================
// SUCCESS CASES
// ============================================================

describe('buildBundle success cases', () => {
  // ----------------------------------------------------------
  // AC-19: bundle.json matches BundleManifest schema
  // ----------------------------------------------------------
  it('produces dist/bundle.json matching BundleManifest schema [AC-19]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    const result = await buildBundle(manifestPath, { outputDir });

    const bundleJsonPath = path.join(outputDir, 'bundle.json');
    expect(existsSync(bundleJsonPath)).toBe(true);

    const raw = await readFile(bundleJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(typeof parsed['name']).toBe('string');
    expect(typeof parsed['version']).toBe('string');
    expect(typeof parsed['built']).toBe('string');
    expect(typeof parsed['checksum']).toBe('string');
    expect(typeof parsed['rillVersion']).toBe('string');
    expect(typeof parsed['agents']).toBe('object');
    expect(parsed['agents']).not.toBeNull();

    // Return value also has the manifest
    expect(result.manifest.name).toBe('test-agent');
    expect(result.manifest.version).toBe('0.1.0');
    expect(result.outputPath).toBe(outputDir);
  });

  // ----------------------------------------------------------
  // AC-20: bundle.json contains sha256 checksum
  // ----------------------------------------------------------
  it('bundle.json contains sha256 checksum in format sha256:<hex> [AC-20]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    const result = await buildBundle(manifestPath, { outputDir });

    expect(result.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.manifest.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.checksum).toBe(result.manifest.checksum);
  });

  // ----------------------------------------------------------
  // AC-21: dist/handlers.js exports a ComposedHandlerMap
  // ----------------------------------------------------------
  it('dist/handlers.js exists and contains export and handlers [AC-21]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    await buildBundle(manifestPath, { outputDir });

    const handlersPath = path.join(outputDir, 'handlers.js');
    expect(existsSync(handlersPath)).toBe(true);

    const content = await readFile(handlersPath, 'utf-8');
    expect(content).toContain('export');
    expect(content).toContain('handlers');
  });

  // ----------------------------------------------------------
  // AC-22: dist/agents/<name>/entry.rill copied
  // ----------------------------------------------------------
  it('copies entry.rill to dist/agents/<name>/entry.rill [AC-22]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    await buildBundle(manifestPath, { outputDir });

    const entryPath = path.join(
      outputDir,
      'agents',
      'test-agent',
      'entry.rill'
    );
    expect(existsSync(entryPath)).toBe(true);

    const content = await readFile(entryPath, 'utf-8');
    expect(content).toBe(MINIMAL_RILL_SCRIPT);
  });

  // ----------------------------------------------------------
  // AC-23: dist/agents/<name>/card.json present per agent
  // ----------------------------------------------------------
  it('writes card.json per agent [AC-23]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    await buildBundle(manifestPath, { outputDir });

    const cardPath = path.join(outputDir, 'agents', 'test-agent', 'card.json');
    expect(existsSync(cardPath)).toBe(true);

    const raw = await readFile(cardPath, 'utf-8');
    const card = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof card['name']).toBe('string');
    expect(card['name']).toBe('test-agent');
  });

  // ----------------------------------------------------------
  // AC-24: modules/ contains module .rill files when declared
  // ----------------------------------------------------------
  it('copies module .rill files when declared [AC-24]', async () => {
    const { manifestPath, outputDir, fixtureDir } = await makeAgentFixture({
      modules: { utils: 'utils.rill' },
    });

    await writeFile(
      path.join(fixtureDir, 'utils.rill'),
      `"utils module"`,
      'utf-8'
    );

    await buildBundle(manifestPath, { outputDir });

    const modulePath = path.join(
      outputDir,
      'agents',
      'test-agent',
      'modules',
      'utils.rill'
    );
    expect(existsSync(modulePath)).toBe(true);

    const content = await readFile(modulePath, 'utf-8');
    expect(content).toBe(`"utils module"`);
  });

  // ----------------------------------------------------------
  // AC-25: functions/ contains compiled .js when declared
  // ----------------------------------------------------------
  it('compiles TypeScript functions to .js when declared [AC-25]', async () => {
    const { manifestPath, outputDir, fixtureDir } = await makeAgentFixture({
      functions: { 'myns::greet': 'greet.ts' },
    });

    await writeFile(
      path.join(fixtureDir, 'greet.ts'),
      `export default function greet(name: string): string { return \`Hello \${name}\`; }`,
      'utf-8'
    );

    await buildBundle(manifestPath, { outputDir });

    const functionsDir = path.join(
      outputDir,
      'agents',
      'test-agent',
      'functions'
    );
    expect(existsSync(functionsDir)).toBe(true);

    // File is sanitized: :: → - (single dash per replacement)
    const compiledPath = path.join(functionsDir, 'myns-greet.js');
    expect(existsSync(compiledPath)).toBe(true);
  });

  // ----------------------------------------------------------
  // AC-26: --output flag writes to custom dir via outputDir option
  // ----------------------------------------------------------
  it('writes output to custom outputDir [AC-26]', async () => {
    const { manifestPath } = await makeAgentFixture();
    const customOutputDir = await makeTmpDir();

    const result = await buildBundle(manifestPath, {
      outputDir: customOutputDir,
    });

    expect(result.outputPath).toBe(customOutputDir);
    expect(existsSync(path.join(customOutputDir, 'bundle.json'))).toBe(true);
    expect(existsSync(path.join(customOutputDir, 'handlers.js'))).toBe(true);
  });

  // ----------------------------------------------------------
  // AC-29: No Dockerfile, .zip, deployment artifacts in output
  // ----------------------------------------------------------
  it('produces no Dockerfile, .zip, or deployment artifacts [AC-29]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    await buildBundle(manifestPath, { outputDir });

    expect(existsSync(path.join(outputDir, 'Dockerfile'))).toBe(false);
    // Walk output dir and assert no .zip files
    const entries = await (async function walk(dir: string): Promise<string[]> {
      const { readdir } = await import('node:fs/promises');
      const items = await readdir(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          results.push(...(await walk(full)));
        } else {
          results.push(full);
        }
      }
      return results;
    })(outputDir);

    const zipFiles = entries.filter((f) => f.endsWith('.zip'));
    expect(zipFiles).toHaveLength(0);

    const dockerFiles = entries.filter(
      (f) => path.basename(f) === 'Dockerfile' || f.endsWith('.dockerfile')
    );
    expect(dockerFiles).toHaveLength(0);
  });

  // ----------------------------------------------------------
  // AC-37: Zero modules → modules: {}, no modules/ dir
  // ----------------------------------------------------------
  it('produces no modules/ dir when modules is empty [AC-37]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture({ modules: {} });

    const result = await buildBundle(manifestPath, { outputDir });

    const agentEntry = result.manifest.agents['test-agent'];
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.modules).toEqual({});

    const modulesDir = path.join(outputDir, 'agents', 'test-agent', 'modules');
    expect(existsSync(modulesDir)).toBe(false);
  });

  // ----------------------------------------------------------
  // AC-38: Zero extensions → extensions: {} in bundle.json
  // ----------------------------------------------------------
  it('bundle.json has extensions: {} when no extensions declared [AC-38]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture({
      extensions: {},
    });

    const result = await buildBundle(manifestPath, { outputDir });

    const agentEntry = result.manifest.agents['test-agent'];
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.extensions).toEqual({});
  });

  // ----------------------------------------------------------
  // AC-39: Zero assets → no assets/ dir (or empty)
  // ----------------------------------------------------------
  it('produces no asset files when assets array is empty [AC-39]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture({ assets: [] });

    await buildBundle(manifestPath, { outputDir });

    const assetsDir = path.join(outputDir, 'assets');
    if (existsSync(assetsDir)) {
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(assetsDir);
      expect(files).toHaveLength(0);
    }
  });

  // ----------------------------------------------------------
  // AC-40: 10-agent harness → all 10 in bundle.json.agents
  // ----------------------------------------------------------
  it('bundles all 10 agents from a harness manifest [AC-40]', async () => {
    const fixtureDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    const agentCount = 10;
    const agents = Array.from({ length: agentCount }, (_, i) => ({
      name: `agent-${i + 1}`,
      entry: `agent-${i + 1}.rill`,
      extensions: {},
      modules: {},
    }));

    // Write main.rill for each agent
    for (const agent of agents) {
      await writeFile(
        path.join(fixtureDir, agent.entry),
        `"${agent.name}"`,
        'utf-8'
      );
    }

    const harnessManifest = { shared: {}, agents };
    const manifestPath = path.join(fixtureDir, 'harness.json');
    await writeFile(
      manifestPath,
      JSON.stringify(harnessManifest, null, 2),
      'utf-8'
    );

    const result = await buildBundle(manifestPath, { outputDir });

    expect(Object.keys(result.manifest.agents)).toHaveLength(agentCount);
    for (const agent of agents) {
      expect(result.manifest.agents[agent.name]).toBeDefined();
    }
  });

  // ----------------------------------------------------------
  // AC-41: Zero custom functions → no functions/ dir
  // ----------------------------------------------------------
  it('produces no functions/ dir when functions is empty [AC-41]', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture({
      functions: {},
    });

    await buildBundle(manifestPath, { outputDir });

    const functionsDir = path.join(
      outputDir,
      'agents',
      'test-agent',
      'functions'
    );
    expect(existsSync(functionsDir)).toBe(false);
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('buildBundle error cases', () => {
  // ----------------------------------------------------------
  // AC-30/EC-10: Missing manifest → ComposeError phase 'validation'
  // ----------------------------------------------------------
  it('throws ComposeError phase validation when manifest is missing [AC-30/EC-10]', async () => {
    const outputDir = await makeTmpDir();
    const nonExistentPath = path.join(outputDir, 'does-not-exist.json');

    await expect(buildBundle(nonExistentPath, { outputDir })).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof ComposeError &&
          e.phase === 'validation' &&
          e.message.includes('Manifest not found')
        );
      }
    );
  });

  // ----------------------------------------------------------
  // AC-31/EC-11: Invalid manifest JSON → ManifestValidationError
  // ----------------------------------------------------------
  it('throws ComposeError phase validation when manifest JSON is invalid [AC-31/EC-11]', async () => {
    const fixtureDir = await makeTmpDir();
    const outputDir = await makeTmpDir();
    const manifestPath = path.join(fixtureDir, 'agent.json');

    await writeFile(manifestPath, '{ this is not valid json }', 'utf-8');

    await expect(buildBundle(manifestPath, { outputDir })).rejects.toSatisfy(
      (e: unknown) => {
        return e instanceof ComposeError && e.phase === 'validation';
      }
    );
  });

  it('throws ManifestValidationError when manifest fails schema validation [EC-11]', async () => {
    const fixtureDir = await makeTmpDir();
    const outputDir = await makeTmpDir();
    const manifestPath = path.join(fixtureDir, 'agent.json');

    // Valid JSON but missing required fields
    await writeFile(
      manifestPath,
      JSON.stringify({ name: 'bad-agent' }),
      'utf-8'
    );

    await expect(
      buildBundle(manifestPath, { outputDir })
    ).rejects.toBeInstanceOf(ManifestValidationError);
  });

  // ----------------------------------------------------------
  // AC-32/EC-13: Missing entry .rill → ComposeError phase 'compilation'
  // ----------------------------------------------------------
  it('throws ComposeError phase compilation when entry.rill is missing [AC-32/EC-13]', async () => {
    const fixtureDir = await makeTmpDir();
    const outputDir = await makeTmpDir();
    const manifestPath = path.join(fixtureDir, 'agent.json');

    // Write manifest but do NOT create main.rill
    await writeFile(
      manifestPath,
      JSON.stringify(
        { ...MINIMAL_AGENT_MANIFEST, entry: 'main.rill' },
        null,
        2
      ),
      'utf-8'
    );

    await expect(buildBundle(manifestPath, { outputDir })).rejects.toSatisfy(
      (e: unknown) => {
        return (
          e instanceof ComposeError &&
          e.phase === 'compilation' &&
          e.message.includes('Entry file not found')
        );
      }
    );
  });

  // ----------------------------------------------------------
  // AC-33/EC-14: TS compile error → ComposeError phase 'compilation'
  // ----------------------------------------------------------
  it('throws ComposeError phase compilation when a function has a TS syntax error [AC-33/EC-14]', async () => {
    const { manifestPath, outputDir, fixtureDir } = await makeAgentFixture({
      functions: { 'broken::fn': 'broken.ts' },
    });

    // Write a TypeScript file with a syntax error
    await writeFile(
      path.join(fixtureDir, 'broken.ts'),
      `export default function broken(: string) { return "bad"; }`,
      'utf-8'
    );

    await expect(buildBundle(manifestPath, { outputDir })).rejects.toSatisfy(
      (e: unknown) => {
        return e instanceof ComposeError && e.phase === 'compilation';
      }
    );
  });

  // ----------------------------------------------------------
  // AC-34/EC-15: Output not writable → ComposeError phase 'bundling'
  // ----------------------------------------------------------
  it('throws ComposeError phase bundling when output dir is not writable [AC-34/EC-15]', async () => {
    const { manifestPath } = await makeAgentFixture();

    // Make a read-only parent directory so mkdir on the outputDir path fails.
    const readOnlyParent = await makeTmpDir();
    const blockedOutputDir = path.join(readOnlyParent, 'output');

    // chmod 000 prevents the process from creating subdirectories inside.
    await import('node:fs/promises').then(({ chmod }) =>
      chmod(readOnlyParent, 0o000)
    );

    try {
      await expect(
        buildBundle(manifestPath, { outputDir: blockedOutputDir })
      ).rejects.toSatisfy((e: unknown) => {
        return e instanceof ComposeError && e.phase === 'bundling';
      });
    } finally {
      // Restore permissions so afterEach cleanup can remove the dir.
      await import('node:fs/promises').then(({ chmod }) =>
        chmod(readOnlyParent, 0o755)
      );
    }
  });
});

// ============================================================
// BOUNDARY CONDITIONS
// ============================================================

describe('buildBundle boundary conditions', () => {
  // ----------------------------------------------------------
  // Verify bundle.json agents record structure
  // ----------------------------------------------------------
  it('bundle.json agents record includes entry, modules, extensions, card per agent', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    const result = await buildBundle(manifestPath, { outputDir });

    const agentEntry = result.manifest.agents['test-agent'];
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.entry).toBe('entry.rill');
    expect(typeof agentEntry!.modules).toBe('object');
    expect(typeof agentEntry!.extensions).toBe('object');
    expect(typeof agentEntry!.card).toBe('object');
    expect(agentEntry!.card.name).toBe('test-agent');
  });

  // ----------------------------------------------------------
  // Verify harness produces name 'harness' in bundle.json
  // ----------------------------------------------------------
  it('harness manifest sets bundle name to harness and version to 0.0.0', async () => {
    const fixtureDir = await makeTmpDir();
    const outputDir = await makeTmpDir();

    await writeFile(path.join(fixtureDir, 'main.rill'), `"hello"`, 'utf-8');

    const harnessManifest = {
      shared: {},
      agents: [
        { name: 'my-agent', entry: 'main.rill', extensions: {}, modules: {} },
      ],
    };
    const manifestPath = path.join(fixtureDir, 'harness.json');
    await writeFile(
      manifestPath,
      JSON.stringify(harnessManifest, null, 2),
      'utf-8'
    );

    const result = await buildBundle(manifestPath, { outputDir });

    expect(result.manifest.name).toBe('harness');
    expect(result.manifest.version).toBe('0.0.0');
  });

  // ----------------------------------------------------------
  // Verify built timestamp is an ISO 8601 string
  // ----------------------------------------------------------
  it('bundle.json built field is a valid ISO 8601 timestamp', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    const result = await buildBundle(manifestPath, { outputDir });

    const parsed = new Date(result.manifest.built);
    expect(parsed.toString()).not.toBe('Invalid Date');
    expect(result.manifest.built).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  // ----------------------------------------------------------
  // Verify rillVersion field is a non-empty string
  // ----------------------------------------------------------
  it('bundle.json rillVersion is a non-empty string', async () => {
    const { manifestPath, outputDir } = await makeAgentFixture();

    const result = await buildBundle(manifestPath, { outputDir });

    expect(typeof result.manifest.rillVersion).toBe('string');
    expect(result.manifest.rillVersion.length).toBeGreaterThan(0);
  });
});
