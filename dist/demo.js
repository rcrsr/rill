/**
 * Rill Runtime Demo
 * Simple test to verify parser + runtime integration
 */
import { createRuntimeContext, execute, parse, } from './index.js';
/** Safely stringify a RillValue */
function fmt(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}
const logs = [];
const ctx = createRuntimeContext({
    variables: {
        name: 'World',
        items: ['apple', 'banana', 'cherry'],
        count: 3,
    },
    functions: {
        greet: (args) => {
            const name = args[0];
            const str = typeof name === 'string' ? name : JSON.stringify(name);
            return `Hello, ${str}!`;
        },
        double: (args) => (typeof args[0] === 'number' ? args[0] * 2 : 0),
    },
    callbacks: {
        onLog: (value) => {
            logs.push(fmt(value));
        },
    },
});
async function runDemo() {
    console.log('=== Rill Runtime Demo ===\n');
    // Test 1: Simple pipe chain with function (bare name, no parens)
    console.log('Test 1: Pipe chain with bare function name');
    const script1 = parse('"World" -> greet');
    const result1 = await execute(script1, ctx);
    console.log(`  Result: ${fmt(result1.value)}\n`);
    // Test 2: Variable access (bare function name)
    console.log('Test 2: Variable access with bare function');
    const script2 = parse('$name -> greet');
    const result2 = await execute(script2, ctx);
    console.log(`  Result: ${fmt(result2.value)}\n`);
    // Test 3: Function calls (log)
    console.log('Test 3: Function calls');
    logs.length = 0;
    const script3 = parse('"Hello" -> log');
    await execute(script3, ctx);
    console.log(`  Logged: ${logs.join(', ')}\n`);
    // Test 4: Conditional with .empty
    console.log('Test 4: Conditional with .empty check');
    const script4 = parse(`
    "" -> .empty ? "was empty" ! "was not empty"
  `);
    const result4 = await execute(script4, ctx);
    console.log(`  Result: ${fmt(result4.value)}\n`);
    // Test 5: Conditional - non-empty case
    console.log('Test 5: Conditional - non-empty case');
    const script5 = parse(`
    "hello" -> .empty ? "was empty" ! "was not empty"
  `);
    const result5 = await execute(script5, ctx);
    console.log(`  Result: ${fmt(result5.value)}\n`);
    // Test 6: For loop
    console.log('Test 6: For loop over array');
    const script6 = parse(`
    $items -> @{
      $ -> log
    }
  `);
    logs.length = 0;
    await execute(script6, ctx);
    console.log(`  Logged: ${logs.join(', ')}\n`);
    // Test 7: While loop (new syntax: cond @ body)
    console.log('Test 7: While loop');
    const script7 = parse(`
    1 -> $x
    ($x < 100) @ {
      $x -> log
      $x -> double -> $x
    }
    $x
  `);
    logs.length = 0;
    const result7 = await execute(script7, ctx);
    console.log(`  Logged: ${logs.join(', ')}`);
    console.log(`  Final: ${fmt(result7.value)}\n`);
    // Test 8: Variable capture (bare function name)
    console.log('Test 8: Variable capture with bare function');
    const script8 = parse(`
    "captured value" -> $myVar
    $myVar -> greet
  `);
    const result8 = await execute(script8, ctx);
    console.log(`  Result: ${fmt(result8.value)}`);
    console.log(`  Captured vars: ${JSON.stringify(result8.variables)}\n`);
    // Test 9: Tuple and dict literals
    console.log('Test 9: Tuple and dict literals');
    const script9 = parse('[1, 2, 3]');
    const result9 = await execute(script9, ctx);
    console.log(`  Tuple: ${fmt(result9.value)}\n`);
    // Test 10: String interpolation
    console.log('Test 10: String interpolation');
    const script10 = parse('"Hello, {$name}!"');
    const result10 = await execute(script10, ctx);
    console.log(`  Result: ${fmt(result10.value)}\n`);
    // Test 11: Pipe var interpolation
    console.log('Test 11: Pipe var interpolation');
    const script11 = parse('"Hello" -> { "Greeting: {$}" }');
    const result11 = await execute(script11, ctx);
    console.log(`  Result: ${fmt(result11.value)}\n`);
    console.log('=== All tests complete ===');
}
runDemo().catch(console.error);
//# sourceMappingURL=demo.js.map