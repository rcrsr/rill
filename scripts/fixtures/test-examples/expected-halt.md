# expected-halt.md fixtures

Hand-built cases proving that a `# Error:` marker is a halt assertion, not a
skip: the runner parses and executes the full block (marker included, since
the rill lexer treats `#` as a comment) and checks that it actually halts.

## Case A: code that genuinely halts under a `# Error:` marker passes

```rill
5 => $x
$x -> .not_a_real_method   # Error: unknown method, must halt
```

## Case B: code that completes despite a `# Error:` marker fails

```rill
5 => $x
$x + 1   # Error: this never actually halts
```
