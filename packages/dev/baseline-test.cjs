#!/usr/bin/env node
/**
 * Dependency-free unit tests for the cross-repository baseline mechanism.
 *
 * `check-standards.sh` guards its own baseline by regenerating it in memory
 * from the tree under test (via `gen-baseline.cjs`) and diffing that against
 * the committed `baseline.json`, as canonicalised JSON values. When the two
 * disagree it reports the six baseline-derived elements (STD-LINT-1/5/9,
 * STD-PM-2, STD-DEP-1/2) as `bad` with "baseline.json is stale". That guard is
 * what stops a pinned-tool bump from shipping a stale baseline to every
 * consumer, but until now nothing regression-tested the guard itself: a
 * refactor of `generate()` or the comparator that stopped reflecting a pin
 * would silently let stale baselines through, and only a production CI run
 * would notice.
 *
 * These tests pin two things directly:
 *   1. `generate()` reflects every canonical pin the baseline records, so a
 *      change to any of them changes its output.
 *   2. The canonical-equality comparator — replicated here byte-for-byte from
 *      the `node -e` block in check-standards.sh — reads a value change as
 *      unequal (stale) and key-order as equal (fresh). Both directions matter:
 *      the first is the guard firing, the second is what keeps a stable
 *      generator's key order from reading as a false staleness.
 *
 * Fixtures are minimal repository trees written to a temp directory, since
 * `generate(root)` reads real files (root package.json, .oxlintrc.json, and the
 * two published manifests). Every tree is removed on exit.
 *
 * Run standalone: `node baseline-test.cjs` from the package root.
 * Wired into: this package's `test` script.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { generate } = require(path.join(__dirname, 'gen-baseline.cjs'));

const stats = { pass: 0, fail: 0 };

function fail(label, detail) {
  stats.fail++;
  console.error(`FAIL: ${label}`);
  if (detail !== undefined) console.error(`  ${detail}`);
}

function check(condition, label, detail) {
  if (condition) {
    stats.pass++;
  } else {
    fail(label, detail);
  }
}

// ============================================================
// The staleness oracle — a byte-for-byte copy of the comparator in
// check-standards.sh (the `node -e` block that decides BASELINE_FRESH). If the
// checker's canonicalisation ever changes, this copy must change with it, and
// these tests are where that divergence surfaces.
// ============================================================

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

// Returns true when the checker would call the baseline fresh (the two agree),
// false when it would report it stale.
function baselineFresh(live, committed) {
  return JSON.stringify(canon(live)) === JSON.stringify(canon(committed));
}

// ============================================================
// Fixture trees — real files on disk, since generate() reads them.
// ============================================================

const createdRoots = [];

// A canonical spec mirroring rill's real shape. Callers pass a mutator to
// perturb exactly one pin, so a failing assertion names the pin that broke.
function baseSpec() {
  return {
    pkg: {
      name: '@rcrsr/rill-root',
      packageManager: 'pnpm@11.18.0',
      devDependencies: {
        '@types/node': '^26.1.2',
        knip: '^6.29.0',
        lefthook: '^2.1.10',
        oxfmt: '^0.61.0',
        oxlint: '^1.76.0',
        typescript: '^7.0.0',
        vitest: '^3.0.0',
      },
    },
    oxlintrc: {
      plugins: ['oxc', 'typescript'],
      rules: {
        'rill/no-duplicate-error-id': 'error',
        'rill/no-spec-id-reference': ['error', { files: ['**/src/**'] }],
      },
    },
    core: { name: '@rcrsr/rill', version: '0.18.0' },
    service: { name: '@rcrsr/rill-language-service', version: '0.18.0' },
  };
}

function buildTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rill-baseline-'));
  createdRoots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(spec.pkg, null, 2)
  );
  fs.writeFileSync(
    path.join(root, '.oxlintrc.json'),
    JSON.stringify(spec.oxlintrc ?? {}, null, 2)
  );
  if (spec.core) {
    fs.mkdirSync(path.join(root, 'packages', 'core'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', 'core', 'package.json'),
      JSON.stringify(spec.core, null, 2)
    );
  }
  if (spec.service) {
    fs.mkdirSync(path.join(root, 'packages', 'service'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', 'service', 'package.json'),
      JSON.stringify(spec.service, null, 2)
    );
  }
  return root;
}

// generate() from a base spec with an optional mutator applied first.
function generateFrom(mutate) {
  const spec = baseSpec();
  if (mutate) mutate(spec);
  return generate(buildTree(spec));
}

function cleanup() {
  for (const root of createdRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ============================================================
// 1. A pin bump is detected as stale — the exact scenario a dependabot
//    tool bump reproduces. One case per shared-tooling pin, so a comparator or
//    generator change that stopped reflecting any single one is caught, not
//    just knip.
// ============================================================

function runStalenessTests() {
  const committed = generateFrom();

  // The regression for the knip 6.29 -> 6.31 bump specifically.
  const knipBumped = generateFrom((s) => {
    s.pkg.devDependencies.knip = '^6.31.0';
  });
  check(
    !baselineFresh(knipBumped, committed),
    'staleness: a knip pin bump reads as stale',
    'generate() output did not change when knip was bumped'
  );

  // Every shared-tooling pin, generically: bump each, expect stale.
  const sharedPins = [
    '@types/node',
    'knip',
    'lefthook',
    'oxfmt',
    'oxlint',
    'typescript',
    'vitest',
  ];
  for (const dep of sharedPins) {
    const live = generateFrom((s) => {
      s.pkg.devDependencies[dep] = '^999.0.0';
    });
    check(
      !baselineFresh(live, committed),
      `staleness: bumping ${dep} reads as stale`,
      `generate() did not reflect a change to ${dep}`
    );
  }

  // A lint-rule severity change is a baseline change (STD-LINT-*).
  const ruleDisabled = generateFrom((s) => {
    s.oxlintrc.rules['rill/no-duplicate-error-id'] = 'off';
  });
  check(
    !baselineFresh(ruleDisabled, committed),
    'staleness: a lint-rule severity change reads as stale'
  );

  // A published-version bump (STD-DEP-adjacent) is a baseline change.
  const coreBumped = generateFrom((s) => {
    s.core.version = '0.19.0';
  });
  check(
    !baselineFresh(coreBumped, committed),
    'staleness: a packages/core version bump reads as stale'
  );

  // The package manager pin (STD-PM-2) is a baseline change.
  const pmBumped = generateFrom((s) => {
    s.pkg.packageManager = 'pnpm@12.0.0';
  });
  check(
    !baselineFresh(pmBumped, committed),
    'staleness: a packageManager pin bump reads as stale'
  );
}

// ============================================================
// 2. A fresh tree reads as fresh, and key order alone never reads as stale —
//    the false-positive the canonicalisation exists to prevent.
// ============================================================

function runFreshnessTests() {
  const a = generateFrom();
  const b = generateFrom();
  check(
    baselineFresh(a, b),
    'freshness: two generations of the same tree agree'
  );

  // The committed file is JSON text; the checker parses it, so a re-serialised
  // copy with shuffled top-level keys must still read as fresh.
  const roundTripped = JSON.parse(JSON.stringify(a));
  const shuffled = {};
  for (const k of Object.keys(roundTripped).reverse()) {
    shuffled[k] = roundTripped[k];
  }
  check(
    baselineFresh(shuffled, a),
    'freshness: top-level key order does not read as stale'
  );

  // Nested key order (inside sharedTooling) must also canonicalise away.
  const nestedShuffle = JSON.parse(JSON.stringify(a));
  const reorderedTooling = {};
  for (const k of Object.keys(nestedShuffle.sharedTooling).reverse()) {
    reorderedTooling[k] = nestedShuffle.sharedTooling[k];
  }
  nestedShuffle.sharedTooling = reorderedTooling;
  check(
    baselineFresh(nestedShuffle, a),
    'freshness: nested key order does not read as stale'
  );
}

// ============================================================
// 3. generate() reflects every canonical pin, and writes nothing. These pin
//    the field-level contract the staleness diff depends on.
// ============================================================

function runContractTests() {
  const b = generateFrom();

  check(
    b.linter === 'oxlint' && b.formatter === 'oxfmt',
    'contract: linter and formatter are fixed',
    JSON.stringify({ linter: b.linter, formatter: b.formatter })
  );

  // sharedTooling captures exactly the shared deps present, and omits ones the
  // tree does not declare.
  const withoutVitest = generateFrom((s) => {
    delete s.pkg.devDependencies.vitest;
  });
  check(
    b.sharedTooling.knip === '^6.29.0',
    'contract: sharedTooling records the declared pin',
    JSON.stringify(b.sharedTooling)
  );
  check(
    !('vitest' in withoutVitest.sharedTooling),
    'contract: an undeclared shared dep is omitted from sharedTooling'
  );
  check(
    !('tsx' in b.sharedTooling),
    'contract: a non-shared dev dep never enters sharedTooling'
  );

  // lintRules flattens the [severity, options] array form to the severity.
  check(
    b.lintRules['rill/no-spec-id-reference'] === 'error' &&
      b.lintRules['rill/no-duplicate-error-id'] === 'error',
    'contract: lint rules flatten to their severity',
    JSON.stringify(b.lintRules)
  );

  // lintPlugins are sorted for a stable diff.
  const unsortedPlugins = generateFrom((s) => {
    s.oxlintrc.plugins = ['typescript', 'oxc'];
  });
  check(
    JSON.stringify(unsortedPlugins.lintPlugins) ===
      JSON.stringify(['oxc', 'typescript']),
    'contract: lintPlugins are sorted',
    JSON.stringify(unsortedPlugins.lintPlugins)
  );

  // typescriptMajor is the leading integer of the range.
  check(
    b.typescriptMajor === '7',
    'contract: typescriptMajor is extracted from the range',
    b.typescriptMajor
  );

  // packageManager passes through verbatim.
  check(
    b.packageManager === 'pnpm@11.18.0',
    'contract: packageManager passes through',
    b.packageManager
  );

  // publishedVersions read each manifest by its own name; core's version comes
  // from packages/core, not root — the two legitimately differ.
  check(
    b.publishedVersions['@rcrsr/rill'] === '0.18.0' &&
      b.publishedVersions['@rcrsr/rill-language-service'] === '0.18.0',
    'contract: publishedVersions read the core and service manifests',
    JSON.stringify(b.publishedVersions)
  );

  // core version is read from packages/core, independent of the root version.
  const coreBehindRoot = generateFrom((s) => {
    s.pkg.version = '0.18.1';
    s.core.version = '0.18.0';
  });
  check(
    coreBehindRoot.publishedVersions['@rcrsr/rill'] === '0.18.0',
    'contract: core version comes from its own manifest, not root',
    JSON.stringify(coreBehindRoot.publishedVersions)
  );

  // generate() is read-only: it must not write a baseline into the tree, or the
  // checker's in-memory diff would always read clean.
  const spec = baseSpec();
  const root = buildTree(spec);
  const before = fs.readdirSync(root).sort();
  generate(root);
  const after = fs.readdirSync(root).sort();
  check(
    JSON.stringify(before) === JSON.stringify(after) &&
      !fs.existsSync(path.join(root, 'baseline.json')),
    'contract: generate() writes nothing to the tree'
  );
}

// ============================================================
// Run
// ============================================================

try {
  runStalenessTests();
  runFreshnessTests();
  runContractTests();
} finally {
  cleanup();
}

if (stats.fail > 0) {
  console.error(
    `FAIL baseline-test: ${stats.fail} failed, ${stats.pass} passed.`
  );
  process.exit(1);
}

console.log(
  `PASS baseline-test: ${stats.pass} assertions passed (baseline staleness + generate contract).`
);
