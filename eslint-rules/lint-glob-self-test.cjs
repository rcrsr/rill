/**
 * CI self-test: verifies rill/no-cross-mixin-any fires on src/runtime/ files.
 *
 * Run from packages/core as cwd (matches pnpm lint exactly).
 * Writes a temporary fixture, runs ESLint, asserts the rule fires, then cleans up.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const fixturePath = path.join(cwd, 'src', 'runtime', '__lint_self_test__.ts');
const eslintBin = path.join(cwd, '..', '..', 'node_modules', '.bin', 'eslint');
const configPath = path.join(cwd, '..', '..', 'eslint.config.js');
const fixtureContent = '(this as any).crossMixinCall();\n';

function cleanup() {
  if (fs.existsSync(fixturePath)) {
    fs.unlinkSync(fixturePath);
  }
}

try {
  fs.writeFileSync(fixturePath, fixtureContent, 'utf8');

  const result = spawnSync(eslintBin, ['--config', configPath, fixturePath], {
    encoding: 'utf8',
  });

  const output = (result.stdout ?? '') + (result.stderr ?? '');

  if (result.status === 0) {
    console.error(
      'FAIL lint-glob-self-test: ESLint exited 0 (no errors). ' +
        'rill/no-cross-mixin-any did not fire on src/runtime/ files. ' +
        'Check that the glob in eslint.config.js matches files when cwd=packages/core.'
    );
    cleanup();
    process.exit(1);
  }

  if (!output.includes('no-cross-mixin-any')) {
    console.error(
      'FAIL lint-glob-self-test: ESLint exited non-zero but output does not contain ' +
        '"no-cross-mixin-any". A different rule or parse error may have fired.\n' +
        'ESLint output:\n' +
        output
    );
    cleanup();
    process.exit(1);
  }

  console.log(
    'PASS lint-glob-self-test: rill/no-cross-mixin-any fires on src/runtime/ files.'
  );
} finally {
  cleanup();
}
