#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nicht gefunden. Bitte Node.js 22 oder neuer installieren: https://nodejs.org"
  exit 1
fi
exec node --disable-warning=ExperimentalWarning src/server.ts
