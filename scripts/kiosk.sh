#!/usr/bin/env bash
# Stake-office TV kiosk launcher. Drop this on the mini-PC that runs the display.
#
#   URL=https://naugsco.github.io/called-to-serve/ ./scripts/kiosk.sh
#
# Defaults to the deployed Pages URL. Override URL=... to point at a local build
# or a different host.

set -euo pipefail

URL="${URL:-https://naugsco.github.io/called-to-serve/}"

# Locate Chrome across platforms.
if [[ "$(uname)" == "Darwin" ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME="$(command -v google-chrome)"
elif command -v chromium >/dev/null 2>&1; then
  CHROME="$(command -v chromium)"
else
  echo "Chrome/Chromium not found." >&2
  exit 1
fi

# --user-data-dir keeps the kiosk profile isolated from the operator's normal Chrome.
exec "$CHROME" \
  --kiosk \
  --start-fullscreen \
  --no-first-run \
  --noerrdialogs \
  --disable-translate \
  --disable-features=TranslateUI \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --user-data-dir="${HOME}/.cache/called-to-serve-kiosk" \
  "$URL"
