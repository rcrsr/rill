/**
 * Static import-graph checks that enforce the package's subpath-export
 * boundaries: root (`src/` files outside `scope/` and `rules/`) and
 * `src/scope/` never reach into `src/rules/`, `src/rules/` never reaches
 * into `src/scope/`, every non-relative import in service source resolves
 * to `@rcrsr/rill` or a Node builtin, and core source never imports the
 * published language-service package.
 *
 * These checks walk the source tree directly (no hardcoded file list) so a
 * newly added file that violates a boundary fails the suite automatically.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = resolve(__dirname);
const CORE_SRC = resolve(__dirname, '../../core/src');

const IMPORT_SPECIFIER_RE =
  /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

/** Recursively lists every `.ts` file under `dir`, excluding `*.test.ts` files. */
function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Extracts every static import/export module specifier referenced by `filePath`. */
function extractImportSpecifiers(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  const specifiers: string[] = [];
  for (const match of content.matchAll(IMPORT_SPECIFIER_RE)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

/** Resolves a relative specifier against its importing file's directory to an absolute path (no extension). */
function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  const resolved = resolve(dirname(fromFile), specifier);
  return resolved.replace(/\.js$/, '');
}

function listServiceRootFiles(): string[] {
  const rootOnly = listSourceFiles(SERVICE_SRC).filter((f) => {
    const rel = relative(SERVICE_SRC, f);
    return !rel.startsWith('scope/') && !rel.startsWith('rules/');
  });
  return rootOnly;
}

function listServiceScopeFiles(): string[] {
  return listSourceFiles(join(SERVICE_SRC, 'scope'));
}

function listServiceRulesFiles(): string[] {
  return listSourceFiles(join(SERVICE_SRC, 'rules'));
}

describe('bundle isolation: root and /scope must not import /rules', () => {
  it('contains no import in root-tree or scope-tree files that resolves into src/rules/', () => {
    const filesToCheck = [
      ...listServiceRootFiles(),
      ...listServiceScopeFiles(),
    ];
    const rulesDir = join(SERVICE_SRC, 'rules');

    const violations: string[] = [];
    for (const file of filesToCheck) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.startsWith('@rcrsr/rill-language-service/rules')) {
          violations.push(
            `${relative(SERVICE_SRC, file)} -> ${specifier} (subpath self-import)`
          );
          continue;
        }
        if (!specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file, specifier);
        if (resolved === rulesDir || resolved.startsWith(rulesDir + '/')) {
          violations.push(`${relative(SERVICE_SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('bundle isolation: /rules must not import /scope', () => {
  it('contains no import in rules-tree files that resolves into src/scope/', () => {
    const scopeDir = join(SERVICE_SRC, 'scope');

    const violations: string[] = [];
    for (const file of listServiceRulesFiles()) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.startsWith('@rcrsr/rill-language-service/scope')) {
          violations.push(
            `${relative(SERVICE_SRC, file)} -> ${specifier} (subpath self-import)`
          );
          continue;
        }
        if (!specifier.startsWith('.')) continue;
        const resolved = resolveRelativeSpecifier(file, specifier);
        if (resolved === scopeDir || resolved.startsWith(scopeDir + '/')) {
          violations.push(`${relative(SERVICE_SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('layer boundary: service depends only on @rcrsr/rill and Node builtins', () => {
  it('contains no non-relative import outside @rcrsr/rill and Node builtin modules', () => {
    const allFiles = listSourceFiles(SERVICE_SRC);
    const builtinSet = new Set(builtinModules);

    const violations: string[] = [];
    for (const file of allFiles) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.startsWith('.')) continue;
        if (specifier === '@rcrsr/rill') continue;
        const bareName = specifier.startsWith('node:')
          ? specifier.slice('node:'.length)
          : specifier;
        if (builtinSet.has(bareName)) continue;
        violations.push(`${relative(SERVICE_SRC, file)} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('layer boundary: core never imports the service package', () => {
  it('contains no import in packages/core/src referencing @rcrsr/rill-language-service', () => {
    const coreFiles = listSourceFiles(CORE_SRC);

    const violations: string[] = [];
    for (const file of coreFiles) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.startsWith('@rcrsr/rill-language-service')) {
          violations.push(`${relative(CORE_SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
