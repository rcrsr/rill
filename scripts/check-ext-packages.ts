#!/usr/bin/env npx tsx
/**
 * Validate ext package.json files for setup consistency.
 *
 * Usage:
 *   npx tsx scripts/check-ext-packages.ts          # check all ext packages
 *   npx tsx scripts/check-ext-packages.ts --fix     # auto-fix what's possible
 *
 * Checks:
 *   - Required fields present
 *   - Field values match canonical patterns
 *   - Scripts match the standard set
 *   - publishConfig, repository, homepage, bugs consistency
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname!, '..');

// ── Canonical values ────────────────────────────────────────────────

const REPO_URL = 'git+https://github.com/rcrsr/rill.git';
const BUGS_URL = 'https://github.com/rcrsr/rill/issues';
const HOMEPAGE_BASE = 'https://github.com/rcrsr/rill/tree/main';

const REQUIRED_SCRIPTS: Record<string, string> = {
  build: 'tsc --build',
  test: 'vitest run',
  typecheck: 'tsc --noEmit',
  lint: 'eslint --config ../../../eslint.config.js src/',
  check: 'pnpm run build && pnpm run test && pnpm run lint',
};

const REQUIRED_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'author',
  'type',
  'main',
  'types',
  'keywords',
  'scripts',
  'peerDependencies',
  'files',
  'repository',
  'homepage',
  'bugs',
  'publishConfig',
] as const;

const REQUIRED_PEER_DEPS: Record<string, string> = {
  '@rcrsr/rill': 'workspace:^',
};

// ── Types ───────────────────────────────────────────────────────────

interface Issue {
  pkg: string;
  field: string;
  message: string;
  fixable: boolean;
}

interface PkgJson {
  [key: string]: unknown;
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  author?: string;
  type?: string;
  main?: string;
  types?: string;
  keywords?: string[];
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  files?: string[];
  repository?: { type?: string; url?: string; directory?: string };
  homepage?: string;
  bugs?: { url?: string };
  publishConfig?: { access?: string };
  private?: boolean;
  dependencies?: Record<string, string>;
}

// ── Discovery ───────────────────────────────────────────────────────

function discoverExtPackages(): string[] {
  const extRoot = path.join(ROOT, 'packages', 'ext');
  return fs
    .readdirSync(extRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(extRoot, d.name))
    .filter((dir) => {
      const pkg = path.join(dir, 'package.json');
      if (!fs.existsSync(pkg)) return false;
      const json: PkgJson = JSON.parse(fs.readFileSync(pkg, 'utf-8'));
      // Skip private packages (like example template)
      return !json.private;
    });
}

// ── Validation ──────────────────────────────────────────────────────

function checkPackage(dir: string): Issue[] {
  const pkgPath = path.join(dir, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf-8');
  const pkg: PkgJson = JSON.parse(raw);
  const name = pkg.name ?? path.basename(dir);
  const relDir = path.relative(ROOT, dir);
  const issues: Issue[] = [];

  function issue(field: string, message: string, fixable = false) {
    issues.push({ pkg: name, field, message, fixable });
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (pkg[field] === undefined) {
      issue(field, `missing required field "${field}"`, true);
    }
  }

  // Field values
  if (pkg.license && pkg.license !== 'MIT') {
    issue('license', `expected "MIT", got "${pkg.license}"`, true);
  }
  if (pkg.type && pkg.type !== 'module') {
    issue('type', `expected "module", got "${pkg.type}"`, true);
  }
  if (pkg.main && pkg.main !== 'dist/index.js') {
    issue('main', `expected "dist/index.js", got "${pkg.main}"`, true);
  }
  if (pkg.types && pkg.types !== 'dist/index.d.ts') {
    issue('types', `expected "dist/index.d.ts", got "${pkg.types}"`, true);
  }

  // Scripts
  if (pkg.scripts) {
    for (const [key, expected] of Object.entries(REQUIRED_SCRIPTS)) {
      const actual = pkg.scripts[key];
      if (!actual) {
        issue(`scripts.${key}`, `missing script "${key}"`, true);
      } else if (actual !== expected) {
        issue(
          `scripts.${key}`,
          `expected "${expected}", got "${actual}"`,
          true
        );
      }
    }
  }

  // Peer dependencies
  if (pkg.peerDependencies) {
    for (const [dep, version] of Object.entries(REQUIRED_PEER_DEPS)) {
      if (!pkg.peerDependencies[dep]) {
        issue('peerDependencies', `missing peer dependency "${dep}"`, true);
      } else if (pkg.peerDependencies[dep] !== version) {
        issue(
          'peerDependencies',
          `"${dep}" should be "${version}", got "${pkg.peerDependencies[dep]}"`,
          true
        );
      }
    }
  }

  // Dev dependencies should include @rcrsr/rill
  if (pkg.devDependencies && !pkg.devDependencies['@rcrsr/rill']) {
    issue(
      'devDependencies',
      'missing "@rcrsr/rill": "workspace:^" in devDependencies',
      true
    );
  }

  // Files
  if (pkg.files && !pkg.files.includes('dist')) {
    issue('files', 'files array should include "dist"', true);
  }

  // Repository
  if (pkg.repository) {
    if (pkg.repository.url !== REPO_URL) {
      issue(
        'repository.url',
        `expected "${REPO_URL}", got "${pkg.repository.url}"`,
        true
      );
    }
    const expectedDir = relDir.replace(/\\/g, '/');
    if (pkg.repository.directory !== expectedDir) {
      issue(
        'repository.directory',
        `expected "${expectedDir}", got "${pkg.repository.directory}"`,
        true
      );
    }
  }

  // Homepage
  const expectedHomepage = `${HOMEPAGE_BASE}/${relDir.replace(/\\/g, '/')}#readme`;
  if (pkg.homepage && pkg.homepage !== expectedHomepage) {
    issue(
      'homepage',
      `expected "${expectedHomepage}", got "${pkg.homepage}"`,
      true
    );
  }

  // Bugs
  if (pkg.bugs && pkg.bugs.url !== BUGS_URL) {
    issue('bugs.url', `expected "${BUGS_URL}", got "${pkg.bugs.url}"`, true);
  }

  // publishConfig
  if (pkg.publishConfig && pkg.publishConfig.access !== 'public') {
    issue(
      'publishConfig.access',
      `expected "public", got "${pkg.publishConfig.access}"`,
      true
    );
  }

  // Keywords should include "rill"
  if (pkg.keywords && !pkg.keywords.includes('rill')) {
    issue('keywords', 'keywords should include "rill"', false);
  }

  // private should NOT be set on public ext packages
  if (pkg.private) {
    issue('private', 'public ext package should not have private: true', true);
  }

  return issues;
}

// ── Fix ─────────────────────────────────────────────────────────────

function fixPackage(dir: string): number {
  const pkgPath = path.join(dir, 'package.json');
  const pkg: PkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const relDir = path.relative(ROOT, dir).replace(/\\/g, '/');
  let fixes = 0;

  // Fix simple missing fields
  if (!pkg.license) {
    pkg.license = 'MIT';
    fixes++;
  }
  if (!pkg.author) {
    pkg.author = 'Andre Bremer';
    fixes++;
  }
  if (!pkg.type) {
    pkg.type = 'module';
    fixes++;
  }
  if (!pkg.main) {
    pkg.main = 'dist/index.js';
    fixes++;
  }
  if (!pkg.types) {
    pkg.types = 'dist/index.d.ts';
    fixes++;
  }
  if (!pkg.files) {
    pkg.files = ['dist'];
    fixes++;
  }

  // Fix scripts
  if (!pkg.scripts) pkg.scripts = {};
  for (const [key, expected] of Object.entries(REQUIRED_SCRIPTS)) {
    if (pkg.scripts[key] !== expected) {
      pkg.scripts[key] = expected;
      fixes++;
    }
  }

  // Fix peerDependencies
  if (!pkg.peerDependencies) pkg.peerDependencies = {};
  for (const [dep, version] of Object.entries(REQUIRED_PEER_DEPS)) {
    if (pkg.peerDependencies[dep] !== version) {
      pkg.peerDependencies[dep] = version;
      fixes++;
    }
  }

  // Fix devDependencies
  if (!pkg.devDependencies) pkg.devDependencies = {};
  if (pkg.devDependencies['@rcrsr/rill'] !== 'workspace:^') {
    pkg.devDependencies['@rcrsr/rill'] = 'workspace:^';
    fixes++;
  }

  // Fix repository
  if (
    !pkg.repository ||
    pkg.repository.url !== REPO_URL ||
    pkg.repository.directory !== relDir
  ) {
    pkg.repository = { type: 'git', url: REPO_URL, directory: relDir };
    fixes++;
  }

  // Fix homepage
  const expectedHomepage = `${HOMEPAGE_BASE}/${relDir}#readme`;
  if (pkg.homepage !== expectedHomepage) {
    pkg.homepage = expectedHomepage;
    fixes++;
  }

  // Fix bugs
  if (!pkg.bugs || pkg.bugs.url !== BUGS_URL) {
    pkg.bugs = { url: BUGS_URL };
    fixes++;
  }

  // Fix publishConfig
  if (!pkg.publishConfig || pkg.publishConfig.access !== 'public') {
    pkg.publishConfig = { access: 'public' };
    fixes++;
  }

  if (fixes > 0) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  return fixes;
}

// ── Main ────────────────────────────────────────────────────────────

const fix = process.argv.includes('--fix');
const dirs = discoverExtPackages();

if (dirs.length === 0) {
  console.log('No public ext packages found.');
  process.exit(0);
}

let totalIssues = 0;
let totalFixes = 0;

for (const dir of dirs) {
  const relDir = path.relative(ROOT, dir);
  const issues = checkPackage(dir);

  if (issues.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m ${relDir}`);
    continue;
  }

  totalIssues += issues.length;
  console.log(`\x1b[31m✗\x1b[0m ${relDir} (${issues.length} issues)`);
  for (const issue of issues) {
    const tag =
      fix && issue.fixable ? '\x1b[33mfix\x1b[0m' : '\x1b[31m!\x1b[0m';
    console.log(`  ${tag} ${issue.field}: ${issue.message}`);
  }

  if (fix) {
    const fixed = fixPackage(dir);
    totalFixes += fixed;
    console.log(`  \x1b[32m→ applied ${fixed} fixes\x1b[0m`);
  }
}

console.log();
if (totalIssues === 0) {
  console.log(`\x1b[32mAll ${dirs.length} ext packages are consistent.\x1b[0m`);
} else if (fix) {
  console.log(
    `Found ${totalIssues} issues across ${dirs.length} packages, applied ${totalFixes} fixes.`
  );
  console.log('Re-run without --fix to verify.');
} else {
  console.log(
    `Found ${totalIssues} issues across ${dirs.length} packages. Run with --fix to auto-fix.`
  );
  process.exit(1);
}
