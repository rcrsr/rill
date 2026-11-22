# pending fences and the skip-ratio guard

Three comment-only blocks trip the guard. The two pending fences fail as
required and count in the total, so the guard sees 3 of 6.

```rill
# comment only
```

```rill
# comment only
```

```rill
# comment only
```

```rill
1 + 1
```

```rill pending=1
this is not valid rill (
```

```rill pending=2
this is not valid rill (
```
