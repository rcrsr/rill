#!/usr/bin/env bash
# Wrapper for local rill-check (avoids global install)
exec node "$(dirname "$0")/../packages/cli/dist/cli-check.js" "$@"
