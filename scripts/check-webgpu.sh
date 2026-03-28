#!/bin/bash
# check-webgpu.sh — Autoresearch harness for WebGPU activation.
# Build → deploy → reload → trigger model load → query gpu_diag → PASS/FAIL
# Usage: bash scripts/check-webgpu.sh [vault_name] [wait_seconds]

set -euo pipefail

VAULT="${1:-Test}"
WAIT="${2:-90}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/webgpu-check-$(date +%Y%m%d-%H%M%S).log"

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "FAIL: Vault not found: $VAULT_PATH"; exit 1
fi
mkdir -p "$PLUGIN_DIR" artifacts

echo "=============================="
echo "WebGPU Check: $VAULT (wait=${WAIT}s)"
echo "=============================="

# 1. Build
echo "[1/6] Build..."
pnpm run build > /dev/null 2>&1 || { echo "FAIL:build"; exit 1; }
echo "  OK"

# 2. Deploy
echo "[2/6] Deploy..."
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
echo "  OK"

# 3. Ensure Obsidian is running
echo "[3/6] Ensure Obsidian running..."
PING=$(obsidian "vault=$VAULT" eval "code=1+1" 2>&1 | grep -v FATAL || true)
if [[ "$PING" != *"2"* ]]; then
  echo "  Starting Obsidian..."
  open -a Obsidian
  sleep 5
  open "obsidian://open?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$VAULT_PATH'))")"
  for i in $(seq 1 30); do
    PING=$(obsidian "vault=$VAULT" eval "code=1+1" 2>&1 | grep -v FATAL || true)
    if [[ "$PING" == *"2"* ]]; then
      echo "  Responsive after ${i}s"
      break
    fi
    sleep 1
  done
else
  echo "  Already running"
fi

# 4. Reload plugin
echo "[4/6] Reload plugin..."
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL || true
sleep 3
echo "  OK"

# 5. Trigger model load and wait for completion
echo "[5/6] Trigger model load..."
obsidian "vault=$VAULT" eval "code=app.plugins.plugins['$PLUGIN'].embed_adapter.load().then(() => 'load_done').catch(e => 'err:' + e.message)" 2>&1 | grep -v FATAL || true

# Poll for adapter.loaded
for i in $(seq 1 "$WAIT"); do
  LOADED=$(obsidian "vault=$VAULT" eval "code=app.plugins.plugins['$PLUGIN']?.embed_adapter?.loaded?.toString()" 2>&1 | grep -v FATAL || true)
  if [[ "$LOADED" == *"true"* ]]; then
    echo "  Model loaded after ${i}s"
    break
  fi
  if (( i % 10 == 0 )); then
    echo "  Waiting... (${i}s)"
  fi
  sleep 1
done

# 6. Query gpu_diag from iframe
echo "[6/6] Query GPU diagnostics..."
GPU_DIAG=$(obsidian "vault=$VAULT" eval "code=app.plugins.plugins['$PLUGIN'].embed_adapter.get_gpu_diag().then(d => JSON.stringify(d)).catch(e => JSON.stringify({error: e.message}))" 2>&1 | grep -v FATAL || true)

# Clean the => prefix from obsidian eval output
GPU_DIAG=$(echo "$GPU_DIAG" | sed 's/^=> //')

echo ""
echo "=============================="
echo "Vault: $VAULT"
echo "Log: $LOGFILE"
echo ""
echo "GPU Diagnostics: $GPU_DIAG"

# Save to log
echo "--- WEBGPU CHECK $(date) ---" > "$LOGFILE"
echo "$GPU_DIAG" >> "$LOGFILE"

# Parse backend
BACKEND=$(echo "$GPU_DIAG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('backend','none'))" 2>/dev/null || echo "parse_error")

echo "Backend: $BACKEND"
echo ""
echo "=============================="

if [[ "$BACKEND" == "webgpu" ]]; then
  echo "RESULT: PASS (webgpu active)"
  exit 0
elif [[ "$BACKEND" == "wasm" ]]; then
  echo "RESULT: FAIL (fell back to wasm)"
  # Print logs for diagnosis
  echo ""
  echo "--- Diagnostic Logs ---"
  echo "$GPU_DIAG" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(l) for l in d.get('logs',[])]" 2>/dev/null || true
  exit 1
else
  echo "RESULT: FAIL (backend=$BACKEND — model may not have loaded)"
  exit 1
fi
