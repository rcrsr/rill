#!/usr/bin/env -S pnpm exec tsx
/**
 * Enumerate the full public export surface of @rcrsr/rill.
 *
 * Parses `packages/core/src/index.ts` (the published entry) and its
 * transitive imports via the TypeScript compiler API, resolves every
 * exported name to its originating source file, and prints one row per
 * export with its kind.
 *
 * Kinds emitted: class, function, interface, type, enum, const-enum,
 * const, let, var, namespace, unknown.
 *
 * This depends on typescript's `unstable/sync` API surface (a native-host
 * client/server protocol, not the classic `createProgram`/`TypeChecker`
 * API), which may change shape across typescript@7 patch releases.
 *
 * Usage:
 *   pnpm exec tsx scripts/list-public-exports.ts [--json]
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  API,
  SymbolFlags,
  type Checker,
  type Project,
  type Symbol as TsSymbol,
} from 'typescript/unstable/sync';
import {
  isVariableDeclaration,
  isVariableDeclarationList,
  NodeFlags,
} from 'typescript/unstable/ast';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'packages/core/src/index.ts');

function loadProject(api: API): Project {
  const configPath = path.join(ROOT, 'packages/core/tsconfig.json');
  api.parseConfigFile(configPath);
  const snapshot = api.updateSnapshot({ openProjects: [configPath] });
  const project = snapshot.getProject(configPath);
  if (!project) {
    console.error(`Cannot load project for ${configPath}`);
    process.exit(1);
  }
  return project;
}

interface ExportEntry {
  name: string;
  kind: string;
  source: string;
}

function classify(symbol: TsSymbol, checker: Checker): string {
  const flags = symbol.flags;
  if (flags & SymbolFlags.Class) return 'class';
  if (flags & SymbolFlags.Function) return 'function';
  if (flags & SymbolFlags.Interface) return 'interface';
  if (flags & SymbolFlags.TypeAlias) return 'type';
  if (flags & SymbolFlags.Enum) return 'enum';
  if (flags & SymbolFlags.ConstEnum) return 'const-enum';
  if (flags & SymbolFlags.BlockScopedVariable) {
    // BlockScopedVariable covers both `const` and `let`. Inspect the
    // declaration's parent to distinguish; default to `let` when the
    // list flag is not present.
    const decl = symbol.declarations?.[0]?.resolve();
    if (decl && isVariableDeclaration(decl)) {
      const list = decl.parent;
      if (isVariableDeclarationList(list) && list.flags & NodeFlags.Const) {
        return 'const';
      }
    }
    return 'let';
  }
  if (flags & SymbolFlags.FunctionScopedVariable) return 'var';
  if (flags & SymbolFlags.Namespace || flags & SymbolFlags.Module)
    return 'namespace';
  if (flags & SymbolFlags.Alias) {
    const resolved = checker.getAliasedSymbol(symbol);
    return classify(resolved, checker);
  }
  return 'unknown';
}

function sourceFileFor(symbol: TsSymbol, checker: Checker): string {
  const target =
    symbol.flags & SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const decl = target.declarations?.[0]?.resolve();
  if (!decl) return '?';
  return path.relative(ROOT, decl.getSourceFile().fileName);
}

function main(): void {
  const api = new API();
  try {
    const project = loadProject(api);
    const checker = project.checker;
    const entryFile = project.program.getSourceFile(ENTRY);
    if (!entryFile) {
      console.error(`Cannot load ${ENTRY}`);
      process.exit(1);
    }
    const moduleSymbol = checker.getSymbolAtLocation(entryFile);
    if (!moduleSymbol) {
      console.error('No module symbol for entry file');
      process.exit(1);
    }

    const exports = checker.getExportsOfModule(moduleSymbol);
    const entries: ExportEntry[] = exports
      .map((s) => ({
        name: s.name,
        kind: classify(s, checker),
        source: sourceFileFor(s, checker),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    console.log(`Total: ${entries.length} exports`);
    console.log('='.repeat(80));
    for (const e of entries) {
      console.log(`${e.name.padEnd(35)} ${e.kind.padEnd(12)} ${e.source}`);
    }
  } finally {
    api.close();
  }
}

main();
