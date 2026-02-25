import { cpSync, mkdirSync, writeFileSync, globSync } from 'node:fs';
import path from 'node:path';
import { generateAgentCard } from '../card.js';
import { assertOutputWritable, buildResolvedManifest } from './helpers.js';
import type { TargetBuilder, BuildContext, BuildResult } from './index.js';

// ============================================================
// HOST ENTRY TEMPLATE
// ============================================================

/**
 * Generates a host.ts that loads agent.json, composes the agent,
 * and starts a full server via @rcrsr/rill-host. Run with: tsx dist/host.ts
 */
function generateHostEntry(context: BuildContext): string {
  if (context.manifest == null) {
    throw new TypeError('context.manifest is required');
  }
  if (!context.manifest.entry) {
    throw new TypeError('context.manifest.entry is required');
  }

  const port = context.manifest.deploy?.port ?? 3000;

  return `import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, composeAgent } from '@rcrsr/rill-compose';
import { createAgentHost } from '@rcrsr/rill-host';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, 'agent.json'), 'utf-8')));
const agent = await composeAgent(manifest, { basePath: __dirname });
const host = createAgentHost(agent, { port: ${port} });
await host.listen(${port});
`;
}

// ============================================================
// OUTPUT WRITE HELPERS
// ============================================================

/**
 * Copies all .rill files from manifestDir to outputDir/scripts/.
 * Preserves relative directory structure.
 */
function copyRillScripts(manifestDir: string, outputDir: string): void {
  const scriptsDir = path.join(outputDir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });

  let entries: string[];
  try {
    entries = globSync('**/*.rill', { cwd: manifestDir });
  } catch {
    entries = [];
  }

  for (const rel of entries) {
    const src = path.join(manifestDir, rel);
    const dest = path.join(scriptsDir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest);
  }
}

/**
 * Copies assets matching manifest glob patterns to outputDir/assets/.
 * Emits a warning (non-blocking) when a pattern matches 0 files.
 */
function copyAssets(
  manifest: { assets?: readonly string[] },
  manifestDir: string,
  outputDir: string
): void {
  const patterns = manifest.assets ?? [];
  if (patterns.length === 0) return;

  const assetsDir = path.join(outputDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  for (const pattern of patterns) {
    let matched: string[];
    try {
      matched = globSync(pattern, { cwd: manifestDir });
    } catch {
      matched = [];
    }

    if (matched.length === 0) {
      process.stderr.write(
        `Warning: asset pattern "${pattern}" matched 0 files\n`
      );
      continue;
    }

    for (const rel of matched) {
      const src = path.join(manifestDir, rel);
      const dest = path.join(assetsDir, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(src, dest);
    }
  }
}

// ============================================================
// LOCAL BUILDER
// ============================================================

const localBuilder: TargetBuilder = {
  target: 'local',

  async build(context: BuildContext): Promise<BuildResult> {
    const { manifest, extensions, outputDir, manifestDir } = context;

    // Generate host entry first — throws TypeError early for EC-6 / EC-7 guards.
    const hostSource = generateHostEntry(context);

    // EC-22: assert output directory is writable
    assertOutputWritable(outputDir);

    // Copy .rill scripts
    copyRillScripts(manifestDir, outputDir);

    // Copy assets (warn on 0 matches, non-blocking)
    copyAssets(manifest, manifestDir, outputDir);

    // Write generated host.ts as-is (no esbuild; users run with tsx)
    writeFileSync(path.join(outputDir, 'host.ts'), hostSource, 'utf-8');

    // Build resolved manifest (FR-BUILD-11)
    const resolvedManifest = buildResolvedManifest(context);
    writeFileSync(
      path.join(outputDir, 'agent.json'),
      JSON.stringify(resolvedManifest, null, 2),
      'utf-8'
    );

    // Generate Agent Card (FR-BUILD-10)
    const card = generateAgentCard(manifest, extensions);
    const wellKnownDir = path.join(outputDir, '.well-known');
    mkdirSync(wellKnownDir, { recursive: true });
    writeFileSync(
      path.join(wellKnownDir, 'agent-card.json'),
      JSON.stringify(card, null, 2),
      'utf-8'
    );

    return {
      outputPath: outputDir,
      target: 'local',
      card,
      resolvedManifest,
    };
  },
};

export { localBuilder };
