# pending-fence.md fixtures

A `rill pending=N` fence runs as a plain fence and is expected to fail; a
plain `rill` fence still runs and must pass.

```rill pending=574
this is not valid rill at all (
```

```rill pending=575
1 + 1
# Error: RILL-R010
```

```rill pending=576
1 + 1
# Result: 3
```

```rill
1 + 1
# Result: 2
```
