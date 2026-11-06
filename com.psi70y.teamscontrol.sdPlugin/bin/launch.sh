#!/bin/sh
# macOS launcher: apps started from the Dock don't inherit your shell PATH, so look for a
# Node.js runtime in the usual places, then run plugin.js with the host app's arguments.
DIR="$(cd "$(dirname "$0")" && pwd)"
for N in /opt/homebrew/bin/node /usr/local/bin/node /opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@20/bin/node "$HOME/.volta/bin/node"; do
  if [ -x "$N" ]; then exec "$N" "$DIR/plugin.js" "$@"; fi
done
for N in "$HOME"/.nvm/versions/node/*/bin/node; do
  if [ -x "$N" ]; then exec "$N" "$DIR/plugin.js" "$@"; fi
done
N="$(command -v node 2>/dev/null)"
if [ -n "$N" ]; then exec "$N" "$DIR/plugin.js" "$@"; fi
mkdir -p "$DIR/../logs"
echo "$(date) no Node.js runtime found - install Node.js 18 or newer" >> "$DIR/../logs/plugin.log"
exit 1
