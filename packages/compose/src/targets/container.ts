import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  globSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { build as esbuild } from 'esbuild';
import { ComposeError } from '../errors.js';
import { generateAgentCard } from '../card.js';
import { assertOutputWritable, buildResolvedManifest } from './helpers.js';
import type { TargetBuilder, BuildContext, BuildResult } from './index.js';

// ============================================================
// DOCKERFILE TEMPLATE
// ============================================================

const DOCKERFILE_TEMPLATE = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm ci --omit=dev

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY host.js .
COPY host.js.map .
COPY scripts ./scripts
COPY assets ./assets
COPY package.json .
EXPOSE 3000
CMD ["node", "host.js"]
`;

// ============================================================
// HOST ENTRY TEMPLATE
// ============================================================

/**
 * Generates a temporary host.ts that sets up an HTTP server,
 * wires extensions, and executes the rill entry script per request.
 */
function generateHostEntry(context: BuildContext): string {
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

  const port = manifest.deploy?.port ?? 3000;
  const healthPath = manifest.deploy?.healthPath ?? '/health';
  const entryScript = manifest.entry;

  return `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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

const server = createServer(async (req, res) => {
  if (req.url === ${JSON.stringify(healthPath)}) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  try {
    const ctx = createRuntimeContext({
      functions: Object.fromEntries(
        [...namespaceMap.entries()].flatMap(([ns, ext]) =>
          Object.entries(ext)
            .filter(([k]) => k !== 'dispose' && typeof ext[k] === 'function')
            .map(([k, fn]) => [\`\${ns}::\${k}\`, fn])
        )
      ),
    });
    const result = await execute(source, ctx);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(${port}, () => {
  process.stderr.write(\`Agent listening on port ${port}\\n\`);
});
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
 * Emits a warning (non-blocking) per AC-24 when a pattern matches 0 files.
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

/**
 * Copies node_modules from manifestDir to outputDir/node_modules/.
 * Only copies if node_modules exists in manifestDir.
 */
function copyNodeModules(manifestDir: string, outputDir: string): void {
  const srcModules = path.join(manifestDir, 'node_modules');
  if (!existsSync(srcModules)) return;

  const destModules = path.join(outputDir, 'node_modules');
  cpSync(srcModules, destModules, { recursive: true });
}

/**
 * Generates package.json for the output directory.
 * Reads installed versions from node_modules to lock deps.
 */
function writePackageJson(
  manifest: { name: string; version: string },
  manifestDir: string,
  outputDir: string
): void {
  const nodeModulesDir = path.join(manifestDir, 'node_modules');
  const deps: Record<string, string> = {};

  if (existsSync(nodeModulesDir)) {
    try {
      const pkgDirs = readdirSync(nodeModulesDir, { withFileTypes: true });
      for (const entry of pkgDirs) {
        if (!entry.isDirectory()) continue;

        // Collect candidate package dirs: scoped packages live under @scope/name.
        const candidates: string[] = entry.name.startsWith('@')
          ? readdirSync(path.join(nodeModulesDir, entry.name)).map(
              (sub) => `${entry.name}/${sub}`
            )
          : [entry.name];

        for (const pkgName of candidates) {
          const pkgJsonPath = path.join(
            nodeModulesDir,
            pkgName,
            'package.json'
          );
          if (!existsSync(pkgJsonPath)) continue;
          try {
            const raw = JSON.parse(
              readFileSync(pkgJsonPath, 'utf-8')
            ) as unknown;
            if (raw !== null && typeof raw === 'object') {
              const rec = raw as Record<string, unknown>;
              const pkgNameVal = rec['name'];
              const pkgVersionVal = rec['version'];
              if (
                typeof pkgNameVal === 'string' &&
                typeof pkgVersionVal === 'string'
              ) {
                deps[pkgNameVal] = pkgVersionVal;
              }
            }
          } catch {
            // Unreadable package.json — skip
          }
        }
      }
    } catch {
      // Unreadable node_modules — produce empty deps
    }
  }

  const packageJson = {
    name: manifest.name,
    version: manifest.version,
    type: 'module',
    main: 'host.js',
    dependencies: deps,
  };

  writeFileSync(
    path.join(outputDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
    'utf-8'
  );
}

// ============================================================
// CONTAINER BUILDER
// ============================================================

const containerBuilder: TargetBuilder = {
  target: 'container',

  async build(context: BuildContext): Promise<BuildResult> {
    const { manifest, extensions, outputDir, manifestDir } = context;

    // EC-22: assert output directory is writable
    assertOutputWritable(outputDir);

    // Write .rill scripts
    copyRillScripts(manifestDir, outputDir);

    // Copy assets (AC-24: warn on 0 matches, non-blocking)
    copyAssets(manifest, manifestDir, outputDir);

    // Generate host entry in a temp file for esbuild
    const hostSource = generateHostEntry(context);
    const tmpDir = os.tmpdir();
    const tmpHostPath = path.join(tmpDir, `rill-host-${manifest.name}.ts`);
    writeFileSync(tmpHostPath, hostSource, 'utf-8');

    // EC-23: compile host entry with esbuild
    const outfile = path.join(outputDir, 'host.js');
    try {
      await esbuild({
        entryPoints: [tmpHostPath],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outfile,
        sourcemap: true,
        metafile: false,
        logLevel: 'silent',
        external: ['@rcrsr/rill'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(`Build failed: ${msg}`, 'bundling');
    }

    // Copy node_modules
    copyNodeModules(manifestDir, outputDir);

    // Write package.json with locked deps
    writePackageJson(manifest, manifestDir, outputDir);

    // Write Dockerfile
    try {
      writeFileSync(
        path.join(outputDir, 'Dockerfile'),
        DOCKERFILE_TEMPLATE,
        'utf-8'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(
        `Failed to generate Dockerfile: ${msg}`,
        'bundling'
      );
    }

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
      target: 'container',
      card,
      resolvedManifest,
    };
  },
};

export { containerBuilder };
