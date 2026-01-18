# rill Examples

Example scripts demonstrating rill language features.

## Running Examples

```bash
# Run an example
npm run rill examples/basics.rill

# Run with inline code
npm run rill -- -e '"hello" -> .len'

# Pipe from stdin
echo '[1, 2, 3] @ { $ * 2 }' | npm run rill -- -
```

## Examples

| File | Description |
|------|-------------|
| `basics.rill` | Pipes, variables, loops, conditionals |
| `loops.rill` | For-each, while loops, limit annotation |
| `dicts.rill` | Dicts, property access, defaults |

## Host-Provided Functions

These examples use only built-in functions. For workflow orchestration, the host runtime provides domain functions:

```typescript
import { parse, execute, createRuntimeContext } from '@rcrsr/rill';

const ctx = createRuntimeContext({
  functions: {
    prompt: async (args) => await callLLM(args[0]),
    exec: async (args) => await runCommand(args[0]),
  },
});

const result = await execute(parse(script), ctx);
```

rill is a vanilla language—all domain-specific functions come from the host.
