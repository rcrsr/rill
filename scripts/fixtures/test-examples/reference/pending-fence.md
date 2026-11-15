# pending-fence.md fixtures

A `rill pending=N` fence is skipped; a plain `rill` fence still runs.

```rill pending=574
this is not valid rill at all (
```

```rill
1 + 1
# Result: 2
```
