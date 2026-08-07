#!/usr/bin/env node
//
// Generates the cross-repository baseline from the tree in the current
// working directory (the repository under test's root, since
// `check-standards.sh` has already `cd`ed there before it ever invokes this).
// Prints JSON to stdout; writes nothing itself.
//
// Two callers, two different reasons not to write the file directly:
//
//   - `fix:baseline` in rill's root `package.json` redirects stdout to
//     `packages/dev/baseline.json`, the file that ships in the npm tarball
//     (see `files` and `exports` in packages/dev/package.json).
//   - `check-standards.sh`, when the repository under test owns the baseline,
//     captures stdout and diffs it against the committed file in memory. A
//     generator that wrote to disk on every run would make that diff always
//     read clean, which is the exact staleness this check exists to catch.
//
// Reads only rill's own tree: root `package.json` and `.oxlintrc.json`, plus
// `packages/core/package.json` and `packages/service/package.json` for the
// published versions this ecosystem pins. `@rcrsr/rill` is `packages/core`,
// which increments only when core changes, unlike root's every-release patch
// bump — so its version is read from its own manifest, not root's.
// REPO-STANDARDS.md §10 names these files as the canonical pins; this script
// is how that stops being prose.

'use strict';

const fs = require('fs');
const path = require('path');
const { readJSONC } = require('./jsonc.cjs');

// Build and test tooling shared across the ecosystem, decided by what rill and
// rill-config both declare as devDependencies at their package roots today:
// the linter, the formatter, the test runner, the compiler, the two hook/dep
// tools, and @types/node. Deliberately excludes repo-specific runtime deps
// (e.g. `semver` in rill-config) and single-repo dev conveniences (e.g. `tsx`,
// which rill-config does not use) — this list is what "shared build and test
// tooling" means for STD-DEP-1, not "every devDependency root declares".
const SHARED_TOOLING_DEPS = [
  '@types/node',
  'knip',
  'lefthook',
  'oxfmt',
  'oxlint',
  'typescript',
  'vitest',
];

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadOptional(p) {
  try {
    return readJSON(p);
  } catch {
    return null;
  }
}

function generate(root) {
  const pkg = readJSON(path.join(root, 'package.json'));
  const oxlintrc = readJSONC(path.join(root, '.oxlintrc.json'));
  const devDeps = pkg.devDependencies || {};

  const lintRules = {};
  for (const [name, value] of Object.entries(oxlintrc.rules || {})) {
    lintRules[name] = Array.isArray(value) ? value[0] : value;
  }

  const sharedTooling = {};
  for (const dep of SHARED_TOOLING_DEPS) {
    if (devDeps[dep] !== undefined) sharedTooling[dep] = devDeps[dep];
  }

  const tsMajorMatch = /(\d+)/.exec(devDeps.typescript || '');

  const publishedVersions = {};
  const corePkg = loadOptional(path.join(root, 'packages/core/package.json'));
  if (corePkg && corePkg.name)
    publishedVersions[corePkg.name] = corePkg.version;
  const servicePkg = loadOptional(
    path.join(root, 'packages/service/package.json')
  );
  if (servicePkg && servicePkg.name)
    publishedVersions[servicePkg.name] = servicePkg.version;

  return {
    linter: 'oxlint',
    formatter: 'oxfmt',
    lintPlugins: (oxlintrc.plugins || []).slice().sort(),
    lintRules,
    packageManager: pkg.packageManager || '',
    typescriptMajor: tsMajorMatch ? tsMajorMatch[1] : '',
    sharedTooling,
    publishedVersions,
  };
}

if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  process.stdout.write(JSON.stringify(generate(root), null, 2) + '\n');
}

module.exports = { generate, SHARED_TOOLING_DEPS };
