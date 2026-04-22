# rill Introduction

*What rill is, who it's for, and why it works this way*

## What is rill?

Think of rill as a scripting language built around one idea: data flows through pipes. Instead of storing values in variables and mutating them step by step, you send data left-to-right through a chain of transformations. The result appears at the end.

rill exists for AI agents that generate and run scripts. An agent receives a task, writes a rill script, and hands it to a host application for execution. You, the human, review the generated code and its output. The language is designed to make that review easy.

Here's what makes rill small on purpose: it has no I/O, no networking, and no filesystem access built in. The host application provides all of those as named functions. That boundary keeps rill safe to run, because the host decides what a script is allowed to do.

## The Problem rill Solves

When AI agents write code in Python or JavaScript, they have access to a huge surface area. They can import arbitrary modules, swallow exceptions silently, coerce types without warning, or produce `None` where you expected a value.

That makes generated scripts hard to trust. Picture yourself reviewing a 20-line Python script: you need to think about implicit coercion, possible exceptions at every call site, and whether `None` might propagate through the logic without anyone noticing.

rill takes a different approach. There is no null. There is no implicit coercion. There are no exceptions. Conditions must be actual booleans. If a type error occurs, the runtime reports it immediately and halts. A rill script cannot keep running in a broken state, so what you review is what actually happened.

## The Pipe Mental Model

If you've used Unix pipes (`cat file | grep pattern | sort`), the core idea will feel familiar. In rill, data does not sit in variables waiting to be read and rewritten. It moves through a pipeline. The `->` operator sends a value to the next step. The `=>` operator captures a value into a named variable when you need it again later.

```rill
"  hello world  " -> .trim -> .upper -> .split(" ")
# Result: ["HELLO", "WORLD"]
```

Notice how each step feeds into the next. You only name intermediate results when the same value appears more than once.

Compare this with the variable-mutation model you may be used to. There, you write a value, modify it in place, and write it again. In rill, you describe the transformations data passes through. The pipeline itself is the program.

## A Vanilla Language

You might wonder why rill has no standard library. That's deliberate.

The host application registers named functions before running any script. A rill script hoists a host-registered extension with `use<ext:app> => $app`, then calls methods via dotted access such as `$app.prompt()` or `$app.fetch()`. A different host could provide `$app.query()` or `$app.write()` instead. The language stays neutral.

This keeps rill portable. The same script syntax works in a CLI tool, a web service, or an IDE plugin. Reviewers can audit exactly which functions the host exposes, and nothing outside that list is reachable from inside a script.

## Type Safety Without Complexity

rill catches every type error at runtime, immediately. You don't need a separate compilation step or type annotations. The runtime validates types as data flows through the pipe.

There is no implicit coercion. Mixing types is always an error, so you never have to guess what `"5" + 1` does (it halts with a clear message).

```rill
42 -> ($ + 8)
# Result: 50
```

```text
# Error: Arithmetic requires number operands
"5" + 1
```

One more guardrail: variables lock to the type of their first value. If you capture a string into `$name`, you cannot later assign a number to `$name`. This rule catches a whole category of bugs where a variable quietly changes type mid-script.

## Values, Not References

Every value in rill is immutable. When you capture a dict into a variable, no operation can modify it afterward. Two variables with the same contents are always equal, because rill compares by value, not by identity.

There is no aliasing and no shared mutable state. Two parts of a script cannot reach each other's data through a hidden reference. Immutability enforces this: the value a variable holds is exactly what was written into it, and nothing can change it.

## Where to Go Next

You now know what rill is and why it's built this way. When you're ready to write code, the Getting Started Guide walks you through installation and your first scripts. If you want to understand the full design philosophy, the Design Principles doc covers each language decision in depth.

## See Also

| Document | Description |
|----------|-------------|
| [Getting Started Guide](guide-getting-started.md) | Install rill and write your first scripts |
| [Troubleshooting](guide-troubleshooting.md) | Common mistakes and how to fix them |
| [Design Principles](topic-design-principles.md) | Full philosophy and mainstream habits to unlearn |
| [Examples](guide-examples.md) | Working code for common workflow patterns |
| [Host Integration](integration-host.md) | Embed rill in a TypeScript application |
| [Reference](ref-language.md) | Complete language syntax specification |
