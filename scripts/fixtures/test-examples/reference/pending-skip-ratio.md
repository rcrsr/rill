# pending fences and the skip-ratio guard

Three comment-only blocks trip the guard. The two pending fences add skips
that the guard ignores, so its counts stay 3 of 4.

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
1 + 1
```

```rill pending=2
1 + 1
```
