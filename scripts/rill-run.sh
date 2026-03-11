#!/usr/bin/env bash
# Wrapper for local rill-run (avoids global install)
exec node "$(dirname "$0")/../packages/cli/dist/cli-run.js" "$@"
