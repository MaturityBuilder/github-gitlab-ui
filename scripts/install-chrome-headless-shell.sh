#!/usr/bin/env bash
# Downloads Chrome's headless shell, which exits after --dump-dom.
# The full Chrome for Testing binary does not.
set -euo pipefail

dest="${CHROME_HEADLESS_DIR:-${RUNNER_TEMP:-/tmp}/chrome-headless-shell}"
mkdir -p "$dest"

version="$(
  curl -fsSL "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["channels"]["Stable"]["version"])'
)"
url="https://storage.googleapis.com/chrome-for-testing-public/${version}/linux64/chrome-headless-shell-linux64.zip"
archive="$dest/chrome-headless-shell.zip"

curl -fsSL --retry 3 --retry-delay 2 -o "$archive" "$url"
unzip -qo "$archive" -d "$dest"
bin="$(find "$dest" -type f -name chrome-headless-shell | head -n 1)"
if [[ -z "$bin" ]]; then
  echo "chrome-headless-shell was not found in $dest" >&2
  exit 1
fi
chmod +x "$bin"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "chrome-path=$bin" >>"$GITHUB_OUTPUT"
fi
printf '%s\n' "$bin"
