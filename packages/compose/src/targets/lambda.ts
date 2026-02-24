import {
  createWriteStream,
  existsSync,
  globSync,
  mkdirSync,
  writeFileSync,
  WriteStream,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { build as esbuild } from 'esbuild';
import { ComposeError } from '../errors.js';
import { generateAgentCard } from '../card.js';
import { assertOutputWritable, buildResolvedManifest } from './helpers.js';
import type { TargetBuilder, BuildContext, BuildResult } from './index.js';

// ============================================================
// ARCHIVER IMPORT (CJS MODULE — NO BUNDLED TYPES)
// ============================================================

// archiver is a CommonJS module. createRequire enables importing it
// from ESM without type declarations.
const require = createRequire(import.meta.url);

interface ArchiverInstance {
  pipe(dest: WriteStream): void;
  file(filepath: string, data: { name: string; date?: Date }): void;
  directory(
    dirpath: string,
    destpath: string,
    data: (entry: { name: string }) => { name: string; date: Date }
  ): void;
  append(source: Buffer, data: { name: string; date?: Date }): void;
  finalize(): Promise<void>;
  on(event: 'error', handler: (err: Error) => void): void;
}

const archiver = require('archiver') as (
  format: string,
  options?: { zlib?: { level?: number } }
) => ArchiverInstance;

// ============================================================
// HOST ENTRY TEMPLATE (LAMBDA)
// ============================================================

/**
 * Generates a Lambda handler host.ts.
 * Lambda invokes exports.handler — no HTTP server needed.
 * All dependencies are bundled by esbuild (bundle: true).
 */
function generateLambdaHostEntry(context: BuildContext): string {
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

  return `import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeContext, execute } from '@rcrsr/rill';
${importLines.join('\n')}

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, 'scripts', ${JSON.stringify(entryScript)});
const source = readFileSync(scriptPath, 'utf-8');

const namespaceMap = new Map([
${wireLines.join('\n')}
]);

export const handler = async (event: unknown): Promise<unknown> => {
  const ctx = createRuntimeContext({
    functions: Object.fromEntries(
      [...namespaceMap.entries()].flatMap(([ns, ext]) =>
        Object.entries(ext as Record<string, unknown>)
          .filter(([k]) => k !== 'dispose' && typeof (ext as Record<string, unknown>)[k] === 'function')
          .map(([k, fn]) => [\`\${ns}::\${k}\`, fn])
      )
    ),
  });
  const result = await execute(source, ctx);
  return { statusCode: 200, body: JSON.stringify({ result, event }) };
};
`;
}

// ============================================================
// LAMBDA BUILDER
// ============================================================

const lambdaBuilder: TargetBuilder = {
  target: 'lambda',

  async build(context: BuildContext): Promise<BuildResult> {
    const { manifest, extensions, outputDir, manifestDir } = context;

    // EC-22: assert output directory is writable
    assertOutputWritable(outputDir);

    // Generate lambda host entry in a temp file for esbuild
    const hostSource = generateLambdaHostEntry(context);
    const tmpDir = os.tmpdir();
    const tmpHostPath = path.join(tmpDir, `rill-lambda-${manifest.name}.ts`);
    writeFileSync(tmpHostPath, hostSource, 'utf-8');

    // EC-23: compile host entry with esbuild — all deps bundled (bundle: true)
    const tmpOutDir = path.join(tmpDir, `rill-lambda-out-${manifest.name}`);
    mkdirSync(tmpOutDir, { recursive: true });
    const hostJsPath = path.join(tmpOutDir, 'host.js');

    try {
      await esbuild({
        entryPoints: [tmpHostPath],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        outfile: hostJsPath,
        sourcemap: false,
        metafile: false,
        logLevel: 'silent',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(`Build failed: ${msg}`, 'bundling');
    }

    // Collect .rill scripts from manifestDir
    let rillEntries: string[] = [];
    try {
      rillEntries = globSync('**/*.rill', { cwd: manifestDir });
    } catch {
      rillEntries = [];
    }

    // Build resolved manifest and agent card
    const resolvedManifest = buildResolvedManifest(context);
    const card = generateAgentCard(manifest, extensions);

    // Create dist.zip using archiver v7 streaming API
    const zipPath = path.join(outputDir, 'dist.zip');

    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    // host.js — esbuild bundle (date: new Date(0) for FR-BUILD-12 determinism)
    archive.file(hostJsPath, { name: 'host.js', date: new Date(0) });

    // scripts/ — all .rill files from manifest directory
    // Only add directory if .rill files exist
    if (rillEntries.length > 0 && existsSync(manifestDir)) {
      archive.directory(manifestDir, 'scripts', (entry) => ({
        ...entry,
        date: new Date(0),
      }));
    }

    // agent.json — resolved manifest as JSON (in-memory, no filesystem write)
    const agentJsonBuffer = Buffer.from(
      JSON.stringify(resolvedManifest, null, 2),
      'utf-8'
    );
    archive.append(agentJsonBuffer, { name: 'agent.json', date: new Date(0) });

    // .well-known/agent-card.json — agent card (in-memory)
    const cardJsonBuffer = Buffer.from(JSON.stringify(card, null, 2), 'utf-8');
    archive.append(cardJsonBuffer, {
      name: '.well-known/agent-card.json',
      date: new Date(0),
    });

    archive.finalize();

    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });

    return {
      outputPath: zipPath,
      target: 'lambda',
      card,
      resolvedManifest,
    };
  },
};

export { lambdaBuilder };
