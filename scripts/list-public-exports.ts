#!/usr/bin/env -S pnpm exec tsx
/**
 * Enumerate the full public export surface of @rcrsr/rill.
 *
 * Loads the module's declaration file via the TypeScript compiler API
 * and lists every exported name with its kind (value/type/interface/class/const).
 *
 * Usage:
 *   pnpm exec tsx scripts/list-public-exports.ts [--json]
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'packages/core/src/index.ts');

function loadProgram(): ts.Program {
  const configPath = path.join(ROOT, 'packages/core/tsconfig.json');
  const configText = fs.readFileSync(configPath, 'utf8');
  const parsed = ts.parseJsonText(configPath, configText);
  const config = ts.parseJsonSourceFileConfigFileContent(
    parsed,
    ts.sys,
    path.dirname(configPath)
  );
  return ts.createProgram({
    rootNames: [ENTRY],
    options: { ...config.options, noEmit: true },
  });
}

interface ExportEntry {
  name: string;
  kind: string;
  source: string;
}

function classify(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  const flags = symbol.flags;
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  if (flags & ts.SymbolFlags.ConstEnum) return 'const-enum';
  if (flags & ts.SymbolFlags.BlockScopedVariable) return 'const';
  if (flags & ts.SymbolFlags.FunctionScopedVariable) return 'var';
  if (flags & ts.SymbolFlags.Namespace || flags & ts.SymbolFlags.Module)
    return 'namespace';
  if (flags & ts.SymbolFlags.Alias) {
    const resolved = checker.getAliasedSymbol(symbol);
    return classify(resolved, checker);
  }
  return 'unknown';
}

function sourceFileFor(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  const target =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const decl = target.declarations?.[0];
  if (!decl) return '?';
  return path.relative(ROOT, decl.getSourceFile().fileName);
}

function main(): void {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const entryFile = program.getSourceFile(ENTRY);
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
}

main();
