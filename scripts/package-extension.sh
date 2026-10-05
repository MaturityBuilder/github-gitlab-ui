#!/usr/bin/env bash
# Zip the extension so manifest.json is at the archive root.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <output.zip> [source-dir]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source="${2:-$ROOT/extension}"
if [[ ! -d "$source" ]]; then
  echo "Extension directory not found: $source" >&2
  exit 1
fi
source="$(cd "$source" && pwd)"

mkdir -p "$(dirname "$1")"
out="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
rm -f "$out"

(cd "$source" && zip -r -X "$out" . -x '*.DS_Store')

if ! unzip -Z1 "$out" | sed 's|^\./||' | grep -qx 'manifest.json'; then
  echo "No manifest found in packaged extension" >&2
  echo "manifest.json has to be at the root of the zip, not inside a folder." >&2
  unzip -l "$out" >&2
  exit 1
fi

printf '%s\n' "$out"
