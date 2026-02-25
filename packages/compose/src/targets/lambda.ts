import {
  createWriteStream,
  globSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  WriteStream,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build as esbuild } from 'esbuild';
import { ComposeError } from '../errors.js';
import { generateAgentCard } from '../card.js';
import { assertOutputWritable, buildResolvedManifest } from './helpers.js';
import type { TargetBuilder, BuildContext, BuildResult } from './index.js';

// ============================================================
// PACKAGE ROOT
// ============================================================

/**
 * Absolute path to the packages/compose directory.
 * Temp files are written to PACKAGE_ROOT/.rill-tmp/ so esbuild
 * resolves @rcrsr/rill from this package's own node_modules.
 */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

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
 * Generates a Lambda handler that statically requires each extension,
 * wires them via hoistExtension, and delegates invocations to
 * createAgentHandler from @rcrsr/rill-host.
 *
 * Static require() calls (not dynamic) allow esbuild to validate and bundle
 * all extensions at build time, causing build failures for unresolvable
 * specifiers (EC-23). esbuild bundles all deps including @rcrsr/rill.
 */
function generateLambdaHostEntry(context: BuildContext): string {
  const { extensions } = context;

  const requireLines: string[] = [];
  const wireLines: string[] = [];

  for (const ext of extensions) {
    const safeVar = ext.alias.replace(/[^a-zA-Z0-9_]/g, '_');
    const specifier = ext.strategy === 'local' ? ext.resolvedPath! : ext.alias;
    requireLines.push(
      `const ${safeVar}Factory = require(${JSON.stringify(specifier)});`
    );
    wireLines.push(
      `    [${JSON.stringify(ext.namespace)}, ${safeVar}Factory, ${JSON.stringify(ext.config)}],`
    );
  }

  const requireBlock =
    requireLines.length > 0 ? requireLines.join('\n') + '\n' : '';

  return `const { createRuntimeContext, hoistExtension, parse } = require('@rcrsr/rill');
const { createAgentHandler } = require('@rcrsr/rill-host');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
${requireBlock}
const manifest = JSON.parse(readFileSync(join(__dirname, 'agent.json'), 'utf-8'));
const extensions = [
${wireLines.join('\n')}
];

let handlerPromise;
function getHandler() {
  if (handlerPromise === undefined) {
    handlerPromise = (async () => {
      let mergedFunctions = {};
      const disposeHandlers = [];
      for (const [namespace, factory, config] of extensions) {
        const instance = factory(config);
        const hoisted = hoistExtension(namespace, instance);
        mergedFunctions = { ...mergedFunctions, ...hoisted.functions };
        if (hoisted.dispose) disposeHandlers.push(hoisted.dispose);
      }
      const rillContext = createRuntimeContext({ functions: mergedFunctions });
      const source = readFileSync(join(__dirname, 'scripts', manifest.entry), 'utf-8');
      const ast = parse(source);
      const card = { name: manifest.name, version: manifest.version, description: "", url: "", skills: [], defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], capabilities: { streaming: false, pushNotifications: false } };
      const agent = {
        ast, context: rillContext, card,
        async dispose() {
          for (const h of [...disposeHandlers].reverse()) {
            try { await h(); } catch {}
          }
        }
      };
      return createAgentHandler(agent);
    })();
  }
  return handlerPromise;
}

exports.handler = async function handler(event, context) {
  const agentHandler = await getHandler();
  return agentHandler(event, context);
};
`;
}

// ============================================================
// LAMBDA BUILDER
// ============================================================

const lambdaBuilder: TargetBuilder = {
  target: 'lambda',

  async build(context: BuildContext): Promise<BuildResult> {
    const { manifest, outputDir, manifestDir } = context;

    // EC-22: assert output directory is writable
    assertOutputWritable(outputDir);

    // Generate lambda host entry in a UUID-named subdirectory co-located with
    // this package so esbuild resolves @rcrsr/rill from packages/compose/node_modules.
    // The fixed filenames ensure esbuild produces deterministic output across
    // concurrent builds; the UUID directory prevents same-name collisions.
    const hostSource = generateLambdaHostEntry(context);
    const tmpBuildDir = path.join(
      PACKAGE_ROOT,
      '.rill-tmp',
      randomUUID().slice(0, 8)
    );
    mkdirSync(tmpBuildDir, { recursive: true });
    const tmpHostPath = path.join(tmpBuildDir, 'lambda.ts');
    const tmpOutDir = path.join(tmpBuildDir, 'out');
    mkdirSync(tmpOutDir, { recursive: true });
    writeFileSync(tmpHostPath, hostSource, 'utf-8');

    // EC-23: compile host entry with esbuild — all deps bundled (bundle: true)
    const hostJsPath = path.join(tmpOutDir, 'host.js');

    try {
      await esbuild({
        entryPoints: [tmpHostPath],
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'cjs',
        outfile: hostJsPath,
        sourcemap: false,
        metafile: false,
        logLevel: 'silent',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(`Build failed: ${msg}`, 'bundling');
    } finally {
      // Remove the entry source — esbuild is done with it.
      // tmpBuildDir (containing out/host.js) is cleaned up after archiver reads it.
      try {
        rmSync(tmpHostPath, { force: true });
      } catch {
        // Best-effort
      }
    }

    // Collect .rill scripts from manifestDir
    let rillEntries: string[];
    try {
      rillEntries = globSync('**/*.rill', { cwd: manifestDir });
    } catch {
      rillEntries = [];
    }

    // Build resolved manifest and agent card
    const resolvedManifest = buildResolvedManifest(context);
    const card = generateAgentCard(manifest);

    // Create dist.zip using archiver v7 streaming API
    const zipPath = path.join(outputDir, 'dist.zip');

    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(output);

    // host.js — esbuild bundle (date: new Date(0) for FR-BUILD-12 determinism)
    archive.file(hostJsPath, { name: 'host.js', date: new Date(0) });

    // scripts/ — .rill files from manifest directory, sorted for deterministic order
    const sortedRillEntries = [...rillEntries].sort();
    for (const rel of sortedRillEntries) {
      const absPath = path.join(manifestDir, rel);
      archive.file(absPath, { name: `scripts/${rel}`, date: new Date(0) });
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

    // Archiver has finished reading host.js — safe to remove the entire temp build dir.
    try {
      rmSync(tmpBuildDir, { recursive: true, force: true });
    } catch {
      // Best-effort
    }

    return {
      outputPath: zipPath,
      target: 'lambda',
      card,
      resolvedManifest,
    };
  },
};

export { lambdaBuilder };
