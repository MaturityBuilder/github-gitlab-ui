#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash -n "$ROOT/scripts/install-local.sh"

FLAGS="$(CHROME_BIN=/bin/echo "$ROOT/scripts/install-local.sh" https://github.com/cli/cli)"
echo "$FLAGS" | grep -q -- "--load-extension=$ROOT/extension"
echo "$FLAGS" | grep -q -- "--disable-extensions-except=$ROOT/extension"
echo "$FLAGS" | grep -q -- "--user-data-dir="
echo "$FLAGS" | grep -q "https://github.com/cli/cli"

MISSING="$(CHROME_BIN=/bin/echo EXTENSION_DIR=/tmp/does-not-exist "$ROOT/scripts/install-local.sh" >/tmp/gl-look-install.out 2>/tmp/gl-look-install.err || true)"
grep -q "manifest not found" /tmp/gl-look-install.err

CHROME="${CHROME_BIN:-}"
if [[ -z "$CHROME" && -x /opt/google/chrome/chrome ]]; then
  CHROME=/opt/google/chrome/chrome
fi
if [[ -z "$CHROME" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME="$(command -v "$candidate")"
      break
    fi
  done
fi

if [[ -z "$CHROME" ]]; then
  echo "Chrome is not installed; fixture browser check skipped." >&2
  exit 1
fi

DUMP="$(mktemp)"
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/gl-look-verify.XXXXXX")"
timeout 30 "$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --user-data-dir="$PROFILE" \
  --allow-file-access-from-files \
  --virtual-time-budget=8000 \
  --dump-dom \
  "file://$ROOT/test/harness.html" >"$DUMP" 2>/tmp/gl-look-chrome.err || true

if ! grep -q 'data-result="pass"' "$DUMP" && ! grep -q "PASS" "$DUMP"; then
  echo "Fixture harness failed" >&2
  cat "$DUMP" >&2
  exit 1
fi

echo "Fixture harness passed"

if [[ -x /opt/google/chrome/chrome ]]; then
  CHROME_BIN=/opt/google/chrome/chrome node "$ROOT/test/live-check.mjs"
fi
