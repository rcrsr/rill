#!/usr/bin/env bash
# Wrapper for local rill-eval (avoids global install)
exec node "$(dirname "$0")/../packages/cli/dist/cli-eval.js" "$@"
