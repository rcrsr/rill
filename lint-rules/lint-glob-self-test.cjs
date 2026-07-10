/**
 * CI self-test: verifies rill/no-cross-mixin-any fires on src/runtime/ files.
 *
 * Run from packages/core as cwd (matches pnpm lint exactly).
 * Writes a temporary fixture, runs oxlint, asserts the rule fires, then cleans up.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const fixturePath = path.join(cwd, 'src', 'runtime', '__lint_self_test__.ts');
// Resolve the oxlint Node entry rather than the platform-specific shim
// (.bin/oxlint on POSIX, oxlint.cmd on Windows). Spawning via process.execPath
// works on all platforms without appending a file extension. We resolve via
// package.json because oxlint's package exports do not expose `./bin/*`.
const oxlintPkg = require.resolve('oxlint/package.json');
const oxlintEntry = path.join(
  path.dirname(oxlintPkg),
  require(oxlintPkg).bin.oxlint
);
const configPath = path.join(cwd, '..', '..', '.oxlintrc.json');
const fixtureContent = '(this as any).crossMixinCall();\n';

function cleanup() {
  if (fs.existsSync(fixturePath)) {
    fs.unlinkSync(fixturePath);
  }
}

try {
  fs.writeFileSync(fixturePath, fixtureContent, 'utf8');

  const result = spawnSync(
    process.execPath,
    [oxlintEntry, '--config', configPath, fixturePath],
    { encoding: 'utf8' }
  );

  const output = (result.stdout ?? '') + (result.stderr ?? '');

  if (result.status === 0) {
    console.error(
      'FAIL lint-glob-self-test: oxlint exited 0 (no errors). ' +
        'rill/no-cross-mixin-any did not fire on src/runtime/ files. ' +
        'Check that the override glob in .oxlintrc.json matches files when cwd=packages/core.'
    );
    cleanup();
    process.exit(1);
  }

  if (!output.includes('no-cross-mixin-any')) {
    console.error(
      'FAIL lint-glob-self-test: oxlint exited non-zero but output does not contain ' +
        '"no-cross-mixin-any". A different rule or parse error may have fired.\n' +
        'oxlint output:\n' +
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
