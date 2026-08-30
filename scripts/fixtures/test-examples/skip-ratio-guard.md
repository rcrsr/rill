# test-examples.ts fixture: skip-ratio guard

Deliberately over-skipped corpus used to exercise the skip-ratio guard
in `scripts/test-examples.ts`. Three of the four blocks below are pure
comments (nothing executable), pushing the skipped ratio for this file
far above the 0.35% threshold pinned just above the measured post-fix
baseline (2/660 ≈ 0.30% across docs/ + README.md).

```rill
# just a comment, nothing to run
```

```rill
# another comment-only block
```

```rill
# yet another comment-only block
```

```rill
1 + 1
```
