#!/usr/bin/env node
/**
 * Verification script for createClaudeCodeExtension factory.
 * Demonstrates config validation and factory API.
 */

import { createClaudeCodeExtension } from './dist/index.js';

console.log('Testing createClaudeCodeExtension factory...\n');

// Test 1: Factory with default config
console.log('✓ Test 1: Default config');
try {
  const ext1 = createClaudeCodeExtension();
  console.log('  - Factory returned:', Object.keys(ext1));
  console.log('  - Has prompt:', ext1.prompt !== undefined);
  console.log('  - Has skill:', ext1.skill !== undefined);
  console.log('  - Has command:', ext1.command !== undefined);
  console.log('  - Has dispose:', ext1.dispose !== undefined);
} catch (error) {
  console.error('  ✗ FAILED:', error.message);
  process.exit(1);
}

// Test 2: Invalid timeout validation
console.log('\n✓ Test 2: Invalid timeout (negative)');
try {
  createClaudeCodeExtension({ defaultTimeout: -1 });
  console.error('  ✗ FAILED: Should have thrown error');
  process.exit(1);
} catch (error) {
  console.log('  - Correctly threw:', error.message);
}

// Test 3: Invalid timeout validation (too large)
console.log('\n✓ Test 3: Invalid timeout (exceeds max)');
try {
  createClaudeCodeExtension({ defaultTimeout: 3600001 });
  console.error('  ✗ FAILED: Should have thrown error');
  process.exit(1);
} catch (error) {
  console.log('  - Correctly threw:', error.message);
}

// Test 4: Valid timeout at boundary
console.log('\n✓ Test 4: Valid timeout at max boundary (3600000)');
try {
  const ext4 = createClaudeCodeExtension({ defaultTimeout: 3600000 });
  console.log('  - Factory accepted max timeout');
  ext4.dispose?.();
} catch (error) {
  console.error('  ✗ FAILED:', error.message);
  process.exit(1);
}

// Test 5: Invalid binary path
console.log('\n✓ Test 5: Invalid binary path');
try {
  createClaudeCodeExtension({ binaryPath: '/nonexistent/binary' });
  console.error('  ✗ FAILED: Should have thrown error');
  process.exit(1);
} catch (error) {
  console.log('  - Correctly threw:', error.message);
}

// Test 6: Dispose idempotency
console.log('\n✓ Test 6: Dispose idempotency');
try {
  const ext6 = createClaudeCodeExtension();
  ext6.dispose?.();
  ext6.dispose?.();
  ext6.dispose?.();
  console.log('  - Multiple dispose() calls succeeded');
} catch (error) {
  console.error('  ✗ FAILED:', error.message);
  process.exit(1);
}

console.log('\n✅ All factory validation tests passed!');
