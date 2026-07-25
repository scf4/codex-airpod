#!/bin/zsh
set -euo pipefail

root="${0:A:h}"

for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -x "$candidate" ]]; then
    exec "$candidate" "$root/src/launch.cjs" "$@"
  fi
done

if command -v node >/dev/null 2>&1; then
  exec "$(command -v node)" "$root/src/launch.cjs" "$@"
fi

print -u2 "Node.js 20 or newer is required."
exit 1
