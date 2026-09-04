# test-examples.ts fixtures

Hand-built cases for validating `scripts/test-examples.ts` marker-line
splitting (issue #240) and the unapplied-callable check (issue #132).

## Case A: a block with a trailing `# Error:` marker runs and must halt

Previously the whole block was skipped because it contained a
`# Error:` marker anywhere in the text. Now the marker is left in
place — the rill lexer already treats `#` as a comment, so the full
block (including the marked line) executes natively, and the runner
asserts that it halts.

```rill
5 => $x
$x + 1
$x -> .not_a_real_method   # Error: bogus method demo, must halt
```

## Case B: a block ending in a bare closure fails

No `# Result:` annotation is present, and the closure is captured into
`$double` and then referenced bare on the final line without being
invoked. This must fail with an "unapplied callable" error.

```rill
|x|($x * 2) => $double
$double
```

## Case C: a normal block ending in a real value stays green

```rill
2 + 2
```
