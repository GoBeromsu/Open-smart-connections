#!/bin/bash
# check-freeze.sh — Autoresearch harness for UI freeze experiments.
# Loop: DB flush → deploy → boot → check ready
# Usage: bash scripts/check-freeze.sh [vault_name] [wait_seconds]

set -euo pipefail

VAULT="${1:-Test}"
WAIT="${2:-30}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "FAIL: Vault not found: $VAULT_PATH"; exit 1
fi
mkdir -p "$PLUGIN_DIR"

echo "=============================="
echo "Freeze Check: $VAULT (wait=${WAIT}s)"
echo "=============================="

# 1. Build
echo "[1/5] Build..."
pnpm run build > /dev/null 2>&1 || { echo "FAIL:build"; exit 1; }
echo "  OK"

# 2. Kill Obsidian + DB flush
echo "[2/5] Kill + flush DB..."
pkill -x Obsidian 2>/dev/null || true
sleep 2
rm -f "$PLUGIN_DIR/open-connections.db"*
echo "  OK"

# 3. Deploy
echo "[3/5] Deploy..."
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
COMMUNITY_PLUGINS="$VAULT_PATH/.obsidian/community-plugins.json"
if [[ -f "$COMMUNITY_PLUGINS" ]]; then
  python3 -c "
import json
path = '$COMMUNITY_PLUGINS'
with open(path) as f:
    plugins = json.load(f)
if '$PLUGIN' not in plugins:
    plugins.append('$PLUGIN')
    with open(path, 'w') as f:
        json.dump(plugins, f, indent=2)
" 2>/dev/null || true
fi
echo "  OK"

# 4. Boot Obsidian
echo "[4/5] Boot Obsidian..."
open -a Obsidian
sleep 5
open "obsidian://open?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$VAULT_PATH'))")"
echo "  Waiting ${WAIT}s..."
sleep "$WAIT"

# 5. Check ready state
echo "[5/5] Checking..."
READY=$(obsidian "vault=$VAULT" eval "code=app.plugins.plugins['$PLUGIN']?.ready?.toString()" 2>&1 | grep -v FATAL || true)
ERRORS=$(obsidian "vault=$VAULT" dev:console level=error 2>&1 | grep -v FATAL | grep -i "open.connections\|open-connections\|SC\]" | head -5 || true)

echo ""
echo "=============================="
echo "Vault: $VAULT"
echo "ready: ${READY:-<empty>}"
if [[ -n "$ERRORS" ]]; then
  echo "errors: $ERRORS"
fi
echo "=============================="

if [[ "$READY" == *"true"* ]]; then
  echo "RESULT: PASS"
  exit 0
else
  echo "RESULT: FAIL (frozen or not loaded)"
  exit 1
fi
