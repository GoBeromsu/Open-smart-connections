#!/bin/bash
# capture-freeze-logs.sh — Race the freeze: poll console rapidly to capture perf logs
# Usage: bash scripts/capture-freeze-logs.sh [vault_name]

set -euo pipefail

VAULT="${1:-Test}"
PLUGIN="open-connections"
LOGFILE="artifacts/freeze-console-$(date +%Y%m%d-%H%M%S).log"
mkdir -p artifacts

echo "=== Freeze Log Capture ==="
echo "Vault: $VAULT"
echo "Output: $LOGFILE"
echo ""

# Kill any existing Obsidian
pkill -x Obsidian 2>/dev/null || true
sleep 2

# Start Obsidian
echo "[1] Starting Obsidian..."
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
open "obsidian://open?path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$VAULT_PATH'))")"

# Wait for Obsidian to be minimally responsive
echo "[2] Waiting for Obsidian to start..."
for i in $(seq 1 20); do
  PING=$(obsidian "vault=$VAULT" eval "code=1+1" 2>&1 | grep -v FATAL || true)
  if [[ "$PING" == *"2"* ]]; then
    echo "  Responsive after ${i}s"
    break
  fi
  sleep 1
done

# Reload plugin and immediately start polling console
echo "[3] Reloading plugin + polling console..."
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL &
RELOAD_PID=$!

# Rapid poll loop — capture console every 0.5s for 30 seconds
echo "[4] Capturing console output (30s)..."
echo "--- CONSOLE CAPTURE START $(date) ---" > "$LOGFILE"

for i in $(seq 1 60); do
  CONSOLE=$(obsidian "vault=$VAULT" dev:console level=log 2>&1 | grep -v FATAL | grep -i "SC\]\|perf\|Init\|Phase\|embed\|collection\|Open Connections" || true)
  if [[ -n "$CONSOLE" ]]; then
    echo "=== t+${i}x0.5s ===" >> "$LOGFILE"
    echo "$CONSOLE" >> "$LOGFILE"
    echo "$CONSOLE"
  fi

  # Also check if ready (means no freeze)
  READY=$(obsidian "vault=$VAULT" eval "code=app.plugins.plugins['$PLUGIN']?.ready?.toString()" 2>&1 | grep -v FATAL || true)
  if [[ "$READY" == *"true"* ]]; then
    echo "" >> "$LOGFILE"
    echo "=== PLUGIN READY at t+${i}x0.5s ===" >> "$LOGFILE"
    echo ""
    echo "PASS — plugin became ready at t+${i}x0.5s"
    break
  fi

  sleep 0.5
done

echo "" >> "$LOGFILE"
echo "--- CONSOLE CAPTURE END $(date) ---" >> "$LOGFILE"

# Final dump
echo ""
echo "=============================="
echo "Captured logs in: $LOGFILE"
cat "$LOGFILE"

wait $RELOAD_PID 2>/dev/null || true
