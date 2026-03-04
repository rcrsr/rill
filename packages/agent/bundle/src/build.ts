import { readFileSync, existsSync } from 'node:fs';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build as esbuild, type BuildFailure } from 'esbuild';
import {
  type AgentManifest,
  type HarnessManifest,
  type HarnessAgentEntry,
  type AgentCard,
  type ManifestExtension,
  type InputSchema,
  type OutputSchema,
  ComposeError,
  validateManifest,
  validateHarnessManifest,
  detectManifestType,
  resolveExtensions,
  generateAgentCard,
  rillShapeToInputSchema,
  rillShapeToOutputSchema,
} from '@rcrsr/rill-agent-shared';
import { isShape, type RillShape } from '@rcrsr/rill';
import { computeChecksum } from './checksum.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface BundleBuildOptions {
  readonly outputDir?: string | undefined;
}

export interface BundleResult {
  readonly outputPath: string;
  readonly manifest: BundleManifest;
  readonly checksum: string;
}

export interface BundleManifest {
  readonly name: string;
  readonly version: string;
  readonly built: string;
  readonly checksum: string;
  readonly rillVersion: string;
  readonly agents: Record<string, BundleAgentEntry>;
}

export interface BundleAgentEntry {
  readonly entry: string;
  readonly modules: Record<string, string>;
  readonly extensions: Record<string, ManifestExtension>;
  readonly card: AgentCard;
  readonly input?: InputSchema | undefined;
  readonly output?: OutputSchema | undefined;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Read the installed @rcrsr/rill version via createRequire.
 * Falls back to 'unknown' if the package.json cannot be resolved.
 */
function readRillVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('@rcrsr/rill/package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      typeof (parsed as Record<string, unknown>)['version'] === 'string'
    ) {
      return (parsed as Record<string, string>)['version']!;
    }
  } catch {
    // Fall through to default
  }
  return 'unknown';
}

/**
 * Compile a TypeScript custom function source file to ESM via esbuild.
 * Writes output to destPath.
 * Throws ComposeError (phase: 'compilation') on file-not-found or build error.
 */
async function compileFunctionToFile(
  srcPath: string,
  destPath: string
): Promise<void> {
  if (!existsSync(srcPath)) {
    throw new ComposeError(
      `Function source not found: ${srcPath}`,
      'compilation'
    );
  }

  try {
    await esbuild({
      entryPoints: [srcPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: destPath,
      logLevel: 'silent',
    });
  } catch (err) {
    const failure = err as BuildFailure;
    if (Array.isArray(failure.errors) && failure.errors.length > 0) {
      const first = failure.errors[0]!;
      const file = first.location?.file ?? srcPath;
      const line = first.location?.line ?? 0;
      const msg = first.text;
      throw new ComposeError(
        `Compilation error in ${file}:${line}: ${msg}`,
        'compilation'
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Compilation error in ${srcPath}:0: ${msg}`,
      'compilation'
    );
  }
}

/**
 * Build a synthetic AgentManifest from a HarnessAgentEntry.
 * Used for card generation which only accepts AgentManifest.
 */
function buildSyntheticManifest(entry: HarnessAgentEntry): AgentManifest {
  return {
    name: entry.name,
    version: '0.0.0',
    runtime: '@rcrsr/rill@*',
    entry: entry.entry,
    modules: entry.modules ?? {},
    extensions: entry.extensions ?? {},
    functions: {},
    assets: [],
    skills: [],
    ...(entry.input !== undefined ? { input: entry.input } : {}),
    ...(entry.output !== undefined ? { output: entry.output } : {}),
  };
}

// ============================================================
// AGENT BUILDER (per-agent file operations)
// ============================================================

interface AgentBuildInput {
  readonly name: string;
  readonly entry: string;
  readonly modules: Record<string, string>;
  readonly extensions: Record<string, ManifestExtension>;
  readonly functions: Record<string, string>;
  readonly card: AgentCard;
  readonly originalManifest: unknown;
  readonly input?: InputSchema | undefined;
  readonly output?: OutputSchema | undefined;
}

/**
 * Build a single agent's output files within the output directory.
 * Returns the written file paths and the BundleAgentEntry.
 */
async function buildAgentFiles(
  agent: AgentBuildInput,
  manifestDir: string,
  outputDir: string
): Promise<{ entry: BundleAgentEntry; writtenFiles: string[] }> {
  const agentOutDir = path.join(outputDir, 'agents', agent.name);
  const writtenFiles: string[] = [];

  // Step: Write agent.json with entry path rewritten to 'entry.rill'.
  // The original manifest entry (e.g. 'main.rill') refers to the source location.
  // Inside the bundle the file is always copied as 'entry.rill', so the
  // stored manifest must reflect that name for composeAgent/composeHarness to load it.
  const agentJsonPath = path.join(agentOutDir, 'agent.json');
  // Sanitize extensions: retain only the 'package' key per entry (AC-2)
  const rawManifest = agent.originalManifest as Record<string, unknown>;
  const rawExtensions = rawManifest['extensions'] as
    | Record<string, Record<string, unknown>>
    | undefined;
  const sanitizedExtensions: Record<string, { package: string }> | undefined =
    rawExtensions !== undefined
      ? Object.fromEntries(
          Object.entries(rawExtensions).map(([alias, ext]) => [
            alias,
            { package: ext['package'] as string },
          ])
        )
      : undefined;
  const bundledManifest: Record<string, unknown> = {
    ...rawManifest,
    entry: 'entry.rill',
    ...(sanitizedExtensions !== undefined
      ? { extensions: sanitizedExtensions }
      : {}),
  };
  await writeFile(
    agentJsonPath,
    JSON.stringify(bundledManifest, null, 2),
    'utf-8'
  );
  writtenFiles.push(agentJsonPath);

  // Step: Write card.json
  const cardJsonPath = path.join(agentOutDir, 'card.json');
  await writeFile(cardJsonPath, JSON.stringify(agent.card, null, 2), 'utf-8');
  writtenFiles.push(cardJsonPath);

  // Step: Copy entry.rill (EC-13 if missing)
  const entrySrcPath = path.resolve(manifestDir, agent.entry);
  if (!existsSync(entrySrcPath)) {
    throw new ComposeError(
      `Entry file not found: ${entrySrcPath}`,
      'compilation'
    );
  }
  const entryDestPath = path.join(agentOutDir, 'entry.rill');
  await copyFile(entrySrcPath, entryDestPath);
  writtenFiles.push(entryDestPath);

  // Step: Copy module .rill files
  const modulesPaths: Record<string, string> = {};
  for (const [alias, relPath] of Object.entries(agent.modules)) {
    const srcPath = path.resolve(manifestDir, relPath);
    const destPath = path.join(agentOutDir, 'modules', `${alias}.rill`);
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
    writtenFiles.push(destPath);
    modulesPaths[alias] = `modules/${alias}.rill`;
  }

  // Step: Compile custom functions via esbuild
  const functionsDir = path.join(agentOutDir, 'functions');
  if (Object.keys(agent.functions).length > 0) {
    await mkdir(functionsDir, { recursive: true });
    for (const [qualifiedName, relSrcPath] of Object.entries(agent.functions)) {
      const srcPath = path.resolve(manifestDir, relSrcPath);
      // Sanitize qualified name for a filename: replace :: and / with -
      const safeName = qualifiedName.replace(/::/g, '-').replace(/\//g, '-');
      const destPath = path.join(functionsDir, `${safeName}.js`);
      await compileFunctionToFile(srcPath, destPath);
      writtenFiles.push(destPath);
    }
  }

  const bundleEntry: BundleAgentEntry = {
    entry: 'entry.rill',
    modules: modulesPaths,
    extensions: agent.extensions,
    card: agent.card,
    ...(agent.input !== undefined ? { input: agent.input } : {}),
    ...(agent.output !== undefined ? { output: agent.output } : {}),
  };

  return { entry: bundleEntry, writtenFiles };
}

// ============================================================
// HANDLERS.JS GENERATION
// ============================================================

/**
 * Generate handlers.js ESM source that exports a ComposedHandlerMap.
 * At runtime the handlers load and execute rill scripts via composeAgent/composeHarness.
 *
 * agentNames: the list of agent names that appear in the bundle.
 * isHarness: when true the original manifest is a HarnessManifest.
 */
function generateHandlersJs(agentNames: string[], isHarness: boolean): string {
  const lines: string[] = [
    `// handlers.js — generated by rill-agent-bundle`,
    `// Do not edit manually.`,
    `import { readFileSync } from 'node:fs';`,
    `import path from 'node:path';`,
    `import { fileURLToPath } from 'node:url';`,
    ``,
    `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
    ``,
  ];

  if (isHarness) {
    lines.push(
      `import { composeHarness } from '@rcrsr/rill-agent-harness';`,
      `import { execute, createRuntimeContext } from '@rcrsr/rill';`,
      ``,
      `/** @type {Map<string, import('@rcrsr/rill-agent-shared').ComposedHandler>} */`,
      `export const handlers = new Map();`,
      ``
    );

    for (const name of agentNames) {
      lines.push(
        `handlers.set(${JSON.stringify(name)}, async (request, _context) => {`,
        `  const manifestSrc = readFileSync(path.join(__dirname, 'agents', ${JSON.stringify(name)}, 'agent.json'), 'utf-8');`,
        `  const agentManifest = JSON.parse(manifestSrc);`,
        `  // Build a synthetic harness manifest for a single agent`,
        `  const harnessManifest = {`,
        `    shared: {},`,
        `    agents: [agentManifest],`,
        `  };`,
        `  const composed = await composeHarness(harnessManifest, {`,
        `    basePath: path.join(__dirname, 'agents', ${JSON.stringify(name)}),`,
        `    config: _context.config ?? {},`,
        `  });`,
        `  const agent = composed.agents.get(agentManifest.name);`,
        `  if (!agent) throw new Error('Agent not found in composed harness');`,
        `  let result;`,
        `  try {`,
        `    // Create a params-scoped context, copying extension functions from the composed context`,
        `    const _onLog = _context.onLog ?? ((msg) => { process.stderr.write(msg + '\\n'); });`,
        `    const _onLogEvent = _context.onLogEvent ?? ((e) => { process.stderr.write(JSON.stringify(e) + '\\n'); });
    const execContext = createRuntimeContext({ variables: request.params ?? {}, callbacks: { onLog: _onLog, onLogEvent: _onLogEvent } });`,
        `    for (const [fnName, fn] of agent.context.functions) {`,
        `      execContext.functions.set(fnName, fn);`,
        `    }`,
        `    const execResult = await execute(agent.ast, execContext);`,
        `    result = execResult.result;`,
        `  } finally {`,
        `    await composed.dispose();`,
        `  }`,
        `  return { state: 'completed', result };`,
        `});`,
        ``
      );
    }
  } else {
    // Single-agent (AgentManifest)
    lines.push(
      `import { composeAgent } from '@rcrsr/rill-agent-harness';`,
      `import { execute, createRuntimeContext } from '@rcrsr/rill';`,
      ``,
      `/** @type {Map<string, import('@rcrsr/rill-agent-shared').ComposedHandler>} */`,
      `export const handlers = new Map();`,
      ``
    );

    for (const name of agentNames) {
      lines.push(
        `handlers.set(${JSON.stringify(name)}, async (request, _context) => {`,
        `  const manifestSrc = readFileSync(path.join(__dirname, 'agents', ${JSON.stringify(name)}, 'agent.json'), 'utf-8');`,
        `  const manifest = JSON.parse(manifestSrc);`,
        `  const composed = await composeAgent(manifest, {`,
        `    basePath: path.join(__dirname, 'agents', ${JSON.stringify(name)}),`,
        `    config: _context.config ?? {},`,
        `  });`,
        `  let result;`,
        `  try {`,
        `    // Create a params-scoped context, copying extension functions from the composed context`,
        `    const _onLog = _context.onLog ?? ((msg) => { process.stderr.write(msg + '\\n'); });`,
        `    const _onLogEvent = _context.onLogEvent ?? ((e) => { process.stderr.write(JSON.stringify(e) + '\\n'); });
    const execContext = createRuntimeContext({ variables: request.params ?? {}, callbacks: { onLog: _onLog, onLogEvent: _onLogEvent } });`,
        `    for (const [fnName, fn] of composed.context.functions) {`,
        `      execContext.functions.set(fnName, fn);`,
        `    }`,
        `    const execResult = await execute(composed.ast, execContext);`,
        `    result = execResult.result;`,
        `  } finally {`,
        `    await composed.dispose();`,
        `  }`,
        `  return { state: 'completed', result };`,
        `});`,
        ``
      );
    }
  }

  return lines.join('\n');
}

// ============================================================
// BUILD BUNDLE
// ============================================================

/**
 * Build a self-contained rill agent bundle from a manifest file.
 *
 * Reads the manifest, validates it, resolves extensions (validation only — DR-1),
 * compiles TypeScript custom functions, copies .rill files and assets,
 * generates handlers.js and bundle.json.
 *
 * @param manifestPath - Absolute or relative path to the manifest JSON file
 * @param options - Optional outputDir (default: 'dist/')
 * @returns BundleResult with output path, manifest, and checksum
 * @throws ComposeError for file/resolution/compilation/bundling failures
 * @throws ManifestValidationError for invalid manifest content
 */
export async function buildBundle(
  manifestPath: string,
  options?: BundleBuildOptions
): Promise<BundleResult> {
  const absManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(absManifestPath);
  const outputDir = path.resolve(options?.outputDir ?? 'dist');

  // EC-10: Manifest not found
  if (!existsSync(absManifestPath)) {
    throw new ComposeError(
      `Manifest not found: ${absManifestPath}`,
      'validation'
    );
  }

  // Step 1: Read and parse manifest JSON
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(readFileSync(absManifestPath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Failed to parse manifest JSON: ${msg}`,
      'validation'
    );
  }

  // Step 2: Auto-detect and validate manifest (EC-11)
  const manifestType = detectManifestType(rawJson);
  let bundleName: string;
  let bundleVersion: string;
  let agentBuildInputs: AgentBuildInput[];
  let isHarness: boolean;

  if (manifestType === 'harness') {
    // EC-11: throws ManifestValidationError if invalid
    const harness: HarnessManifest = validateHarnessManifest(rawJson);
    bundleName = 'harness';
    bundleVersion = '0.0.0';
    isHarness = true;
    agentBuildInputs = harness.agents.map((entry) => {
      const synthetic = buildSyntheticManifest(entry);
      const resolvedInput =
        entry.input !== undefined && isShape(entry.input)
          ? rillShapeToInputSchema(entry.input as unknown as RillShape)
          : entry.input;
      const resolvedOutput =
        entry.output !== undefined && isShape(entry.output)
          ? rillShapeToOutputSchema(entry.output as unknown as RillShape)
          : entry.output;
      return {
        name: entry.name,
        entry: entry.entry,
        modules: entry.modules ?? {},
        extensions: entry.extensions ?? {},
        functions: {},
        card: generateAgentCard(synthetic),
        originalManifest: entry,
        input: resolvedInput,
        output: resolvedOutput,
      };
    });

    // Step 3: Validate extensions load (DR-1 — do NOT instantiate)
    const resolveOpts = { manifestDir };
    // Validate shared extensions
    if (Object.keys(harness.shared).length > 0) {
      await resolveExtensions(harness.shared, resolveOpts);
    }
    // Validate per-agent extensions
    for (const entry of harness.agents) {
      if (entry.extensions && Object.keys(entry.extensions).length > 0) {
        await resolveExtensions(entry.extensions, resolveOpts);
      }
    }
  } else {
    // EC-11: throws ManifestValidationError if invalid
    const manifest: AgentManifest = validateManifest(rawJson);
    bundleName = manifest.name;
    bundleVersion = manifest.version;
    isHarness = false;
    agentBuildInputs = [
      {
        name: manifest.name,
        entry: manifest.entry,
        modules: manifest.modules,
        extensions: manifest.extensions,
        functions: manifest.functions,
        card: generateAgentCard(manifest),
        originalManifest: manifest,
        input: manifest.input,
        output: manifest.output,
      },
    ];

    // Step 3: Validate extensions load (DR-1 — do NOT instantiate)
    if (Object.keys(manifest.extensions).length > 0) {
      await resolveExtensions(manifest.extensions, { manifestDir });
    }
  }

  // Step 4: Idempotency — clean output directory
  try {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Cannot write to output directory ${outputDir}: ${msg}`,
      'bundling'
    );
  }

  // Create agents/ and assets/ directories
  await mkdir(path.join(outputDir, 'agents'), { recursive: true });
  await mkdir(path.join(outputDir, 'assets'), { recursive: true });

  // Step 5–8: Per-agent file operations
  const allWrittenFiles: string[] = [];
  const agentEntries: Record<string, BundleAgentEntry> = {};

  for (const agent of agentBuildInputs) {
    const agentOutDir = path.join(outputDir, 'agents', agent.name);
    try {
      await mkdir(agentOutDir, { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ComposeError(
        `Cannot create agent output directory ${agentOutDir}: ${msg}`,
        'bundling'
      );
    }

    const { entry, writtenFiles } = await buildAgentFiles(
      agent,
      manifestDir,
      outputDir
    );
    agentEntries[agent.name] = entry;
    allWrittenFiles.push(...writtenFiles);
  }

  // Step 7: Copy assets (from agent manifests)
  // For single AgentManifest, copy declared assets.
  // agentBuildInputs[0].originalManifest is the already-validated AgentManifest.
  if (!isHarness && agentBuildInputs.length === 1) {
    const manifest = agentBuildInputs[0]!.originalManifest as AgentManifest;
    for (const assetRelPath of manifest.assets) {
      const srcPath = path.resolve(manifestDir, assetRelPath);
      const assetName = path.basename(assetRelPath);
      const destPath = path.join(outputDir, 'assets', assetName);
      try {
        await copyFile(srcPath, destPath);
        allWrittenFiles.push(destPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ComposeError(
          `Cannot copy asset ${srcPath}: ${msg}`,
          'bundling'
        );
      }
    }
  }

  // Step 9: Generate handlers.js
  const agentNames = agentBuildInputs.map((a) => a.name);
  const handlersJs = generateHandlersJs(agentNames, isHarness);
  const handlersPath = path.join(outputDir, 'handlers.js');
  try {
    await writeFile(handlersPath, handlersJs, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Cannot write handlers.js to ${handlersPath}: ${msg}`,
      'bundling'
    );
  }
  allWrittenFiles.push(handlersPath);

  // Step 10: Compute checksum over all output files in sorted order
  const sortedFiles = [...allWrittenFiles].sort();
  const checksum = await computeChecksum(sortedFiles);

  // Step 11: Generate bundle.json
  const rillVersion = readRillVersion();
  const bundleManifest: BundleManifest = {
    name: bundleName,
    version: bundleVersion,
    built: new Date().toISOString(),
    checksum,
    rillVersion,
    agents: agentEntries,
  };

  const bundleJsonPath = path.join(outputDir, 'bundle.json');
  try {
    await writeFile(
      bundleJsonPath,
      JSON.stringify(bundleManifest, null, 2),
      'utf-8'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ComposeError(
      `Cannot write bundle.json to ${bundleJsonPath}: ${msg}`,
      'bundling'
    );
  }

  return {
    outputPath: outputDir,
    manifest: bundleManifest,
    checksum,
  };
}
