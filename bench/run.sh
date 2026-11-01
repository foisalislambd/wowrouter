#!/usr/bin/env bash
# Build WowRouter and run the local benchmark. Flags are passed through
# to the harness, for example: ./bench/run.sh -quick
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bench/bin
go build -trimpath -o bench/bin/wowrouter ./apps/server/cmd/wowrouter
go build -trimpath -o bench/bin/wowrouter-bench ./bench
version="$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)".*/\1/p' package.json | head -1)"
commit="$(git rev-parse --short HEAD)"
exec ./bench/bin/wowrouter-bench \
  -bin "$PWD/bench/bin/wowrouter" \
  -version "$version" \
  -commit "$commit" \
  "$@"
