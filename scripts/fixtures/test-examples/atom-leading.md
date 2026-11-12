# test-examples.ts fixture: atom-leading blocks

Blocks whose first line starts with an atom literal are executable code, not
comments. The last block holds only comment and divider lines and stays skipped.

```rill
#TIMEOUT -> string
# Result: "TIMEOUT"
```

```rill
#wired -> string
# Result: "wired"
```

```rill
#
##
# -----
```
