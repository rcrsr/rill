#!/usr/bin/env bash
# Wrapper for local rill-exec (avoids global install)
exec node "$(dirname "$0")/../packages/cli/dist/cli-exec.js" "$@"
