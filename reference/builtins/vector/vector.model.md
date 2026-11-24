---
id: vector.model
title: vector.model
status: normative
since: 0.24.0
issues: []
grammar: []
errors: []
depends: [method]
tests: [vectors.test.ts, builtin-duration-vector.test.ts]
---

# vector.model

`.model` yields the model name a vector carries.

## Syntax

```text
vector.model() -> string
```

## Evaluation

r[vector.model.name] .model yields the model name
`.model` MUST yield, as a string, the model name the host gave the receiver.

## Examples

```rill
use<ext:app> => $app
$app.embed("a") => $v
$v.model.^type.name
# Result: "string"
```
