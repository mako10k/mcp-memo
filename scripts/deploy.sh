#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm use 22.16.0 >/dev/null
fi

echo "Building STDIO adapter..."
(
  cd "$ROOT/packages/stdio"
  npm run build
)

echo "Deploying Cloudflare worker..."
(
  cd "$ROOT/packages/server"
  wrangler deploy --config wrangler.toml "$@"
)
