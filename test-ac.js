const { parse, execute, createRuntimeContext } = require('./dist/index.js');

async function test() {
  try {
    // AC-28: Auto-invoke closure in negation
    const src = `
      |x|($x > 0) :> $pos
      5 -> (! $pos)
    `;
    const ast = parse(src);
    const ctx = createRuntimeContext();
    const result = await execute(ast, ctx);
    console.log('AC-28 result:', result.value, '(expected: false)');
  } catch (err) {
    console.error('AC-28 failed:', err.message);
  }
  
  try {
    // AC-29: Auto-invoke in arithmetic
    const src = `
      || { $ + 1 } :> $inc
      5 -> ($inc + 10)
    `;
    const ast = parse(src);
    const ctx = createRuntimeContext();
    const result = await execute(ast, ctx);
    console.log('AC-29 result:', result.value, '(expected: 16)');
  } catch (err) {
    console.error('AC-29 failed:', err.message);
  }
  
  try {
    // AC-30: Auto-invoke in comparison
    const src = `
      |x| { $x } :> $id
      "test" -> ($id == "test")
    `;
    const ast = parse(src);
    const ctx = createRuntimeContext();
    const result = await execute(ast, ctx);
    console.log('AC-30 result:', result.value, '(expected: true)');
  } catch (err) {
    console.error('AC-30 failed:', err.message);
  }
  
  try {
    // AC-31: Closure returns non-boolean
    const src = `
      |x|($x + 1) :> $inc
      5 -> (! $inc)
    `;
    const ast = parse(src);
    const ctx = createRuntimeContext();
    const result = await execute(ast, ctx);
    console.log('AC-31 result: should have thrown, got', result.value);
  } catch (err) {
    console.log('AC-31 correctly threw:', err.message);
  }
  
  try {
    // AC-35: Both closures in && auto-invoked
    const src = `
      |x|($x > 0) :> $a
      |x|($x < 10) :> $b
      5 -> ($a && $b)
    `;
    const ast = parse(src);
    const ctx = createRuntimeContext();
    const result = await execute(ast, ctx);
    console.log('AC-35 result:', result.value, '(expected: true)');
  } catch (err) {
    console.error('AC-35 failed:', err.message);
  }
}

test();
