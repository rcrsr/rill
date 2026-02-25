import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { ComposeError } from '../errors.js';
import { generateAgentCard } from '../card.js';
import { checkTargetCompatibility } from '../compat.js';
import { assertOutputWritable, buildResolvedManifest } from './helpers.js';
import type { TargetBuilder, BuildContext, BuildResult } from './index.js';

// ============================================================
// PACKAGE ROOT
// ============================================================

/**
 * Absolute path to the packages/compose directory.
 * The worker entry temp file is written here so that esbuild
 * resolves @rcrsr/rill from this package's own node_modules.
 */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

// ============================================================
// HOST ENTRY TEMPLATE
// ============================================================

/**
 * Generates a temporary worker entry that wires extensions and executes
 * the rill entry script as a Cloudflare Worker fetch handler.
 */
function generateWorkerEntry(context: BuildContext): string {
  const { manifest, extensions } = context;

  const importLines: string[] = [];
  const wireLines: string[] = [];

  for (const ext of extensions) {
    const safeVar = ext.alias.replace(/[^a-zA-Z0-9_]/g, '_');
    importLines.push(
      `import ${safeVar}Factory from ${JSON.stringify(ext.alias)};`
    );
    wireLines.push(
      `  [${JSON.stringify(ext.namespace)}, ${safeVar}Factory(${JSON.stringify(ext.config)})],`
    );
  }

  const entryScript = manifest.entry;

  return `import { createRuntimeContext, execute } from '@rcrsr/rill';
${importLines.join('\n')}

const source = ${JSON.stringify(`// entry: ${entryScript}`)};

const namespaceMap = new Map([
${wireLines.join('\n')}
]);

export default {
  async fetch(request, env, ctx) {
    try {
      const rillCtx = createRuntimeContext({
        functions: Object.fromEntries(
          [...namespaceMap.entries()].flatMap(([ns, ext]) =>
            Object.entries(ext)
              .filter(([k]) => k !== 'dispose' && typeof ext[k] === 'function')
              .map(([k, fn]) => [\`\${ns}::\${k}\`, fn])
          )
        ),
      });
      const result = await execute(source, rillCtx);
      return new Response(JSON.stringify({ result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
`;
}

// ============================================================
// WORKER BUILDER
// ============================================================

const workerBuilder: TargetBuilder = {
  target: 'worker',

  async build(context: BuildContext): Promise<BuildResult> {
    const { manifest, extensions, outputDir } = context;

    // EC-22: assert output directory is writable
    assertOutputWritable(outputDir);

    // EC-20 / EC-21: check extension compatibility with worker target
    await checkTargetCompatibility(extensions, 'worker');

    // Generate worker entry in a UUID-named subdirectory co-located with this
    // package so esbuild resolves @rcrsr/rill from packages/compose/node_modules.
    // The fixed filename 'worker.ts' ensures esbuild produces deterministic output
    // across concurrent builds; the UUID directory prevents same-name collisions.
    const workerSource = generateWorkerEntry(context);
    const tmpWorkerDir = path.join(
      PACKAGE_ROOT,
      '.rill-tmp',
      randomUUID().slice(0, 8)
    );
    mkdirSync(tmpWorkerDir, { recursive: true });
    const tmpWorkerPath = path.join(tmpWorkerDir, 'worker.ts');
    writeFileSync(tmpWorkerPath, workerSource, 'utf-8');

    // EC-23: compile worker entry with esbuild
    const outfile = path.join(outputDir, 'worker.js');
    try {
      await esbuild({
        entryPoints: [tmpWorkerPath],
        bundle: true,
        platform: 'browser',
        target: 'es2022',
        format: 'esm',
        outfile,
        sourcemap: false,
        metafile: false,
        logLevel: 'silent',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(`Build failed: ${msg}`, 'bundling');
    } finally {
      try {
        rmSync(tmpWorkerDir, { recursive: true, force: true });
      } catch {
        // Temp file cleanup is best-effort
      }
    }

    // Build resolved manifest (FR-BUILD-11)
    const resolvedManifest = buildResolvedManifest(context);
    writeFileSync(
      path.join(outputDir, 'agent.json'),
      JSON.stringify(resolvedManifest, null, 2),
      'utf-8'
    );

    // Generate Agent Card (FR-BUILD-10)
    const card = generateAgentCard(manifest);
    const wellKnownDir = path.join(outputDir, '.well-known');
    mkdirSync(wellKnownDir, { recursive: true });
    writeFileSync(
      path.join(wellKnownDir, 'agent-card.json'),
      JSON.stringify(card, null, 2),
      'utf-8'
    );

    return {
      outputPath: outputDir,
      target: 'worker',
      card,
      resolvedManifest,
    };
  },
};

export { workerBuilder };
