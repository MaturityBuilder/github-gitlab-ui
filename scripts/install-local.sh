#!/usr/bin/env bash
# Launch a throwaway Chrome profile with this unpacked extension loaded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="${EXTENSION_DIR:-$ROOT/extension}"

if [[ ! -f "$EXT/manifest.json" ]]; then
  echo "Extension manifest not found at $EXT" >&2
  exit 1
fi

find_browser() {
  if [[ -n "${CHROME_BIN:-}" ]]; then
    if [[ -x "$CHROME_BIN" ]] || command -v "$CHROME_BIN" >/dev/null 2>&1; then
      if [[ -x "$CHROME_BIN" ]]; then
        printf '%s\n' "$CHROME_BIN"
      else
        command -v "$CHROME_BIN"
      fi
      return 0
    fi
    echo "CHROME_BIN is set but not executable: $CHROME_BIN" >&2
    return 1
  fi
  local candidate
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

print_manual() {
  cat <<EOF
No Chrome or Chromium binary found.
Load the extension manually:
  1. Open chrome://extensions
  2. Enable Developer mode
  3. Click Load unpacked
  4. Select: $EXT
EOF
}

if ! BIN="$(find_browser)"; then
  print_manual
  exit 1
fi

if [[ -n "${CHROME_USER_DATA_DIR:-}" ]]; then
  PROFILE="$CHROME_USER_DATA_DIR"
else
  PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/gl-look-chrome.XXXXXX")"
fi
mkdir -p "$PROFILE"

if [[ "$#" -eq 0 ]]; then
  set -- "https://github.com"
fi

chrome_ignores_load_extension() {
  local version major
  version="$("$BIN" --version 2>/dev/null || true)"
  [[ "$version" == Google\ Chrome\ * ]] || return 1
  major="${version#Google Chrome }"
  major="${major%%.*}"
  [[ "$major" -ge 137 ]]
}

if chrome_ignores_load_extension; then
  if ! command -v node >/dev/null 2>&1; then
    cat <<EOF >&2
This Chrome build ignores --load-extension.
Node is required to load the unpacked extension, and node was not found.
Load it manually:
  1. Open chrome://extensions
  2. Enable Developer mode
  3. Click Load unpacked
  4. Select: $EXT
EOF
    exit 1
  fi
  export CHROME_BIN="$BIN"
  exec node "$ROOT/scripts/launch-chrome.mjs" "$EXT" "$PROFILE" "$@"
fi

exec "$BIN" \
  --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" \
  --load-extension="$EXT" \
  "$@"
