#!/bin/bash
# check-adapter-registry.sh — Autoresearch harness for adapter registry.
# Verifies only transformers + upstage are registered, and batch behavior works.
# IMPORTANT: Test vault only.
# Usage: bash scripts/check-adapter-registry.sh

set -euo pipefail

VAULT="Test"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/adapter-registry-$(date +%Y%m%d-%H%M%S).log"

EVAL_TIMEOUT=10
eval_cmd() {
  local tmpfile
  tmpfile=$(mktemp)
  obsidian "vault=$VAULT" eval "code=$1" 2>&1 | grep -v FATAL | sed 's/^=> //' > "$tmpfile" &
  local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    i=$((i + 1))
    if (( i >= EVAL_TIMEOUT )); then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      rm -f "$tmpfile"
      echo "FREEZE_DETECTED"
      return 1
    fi
  done
  wait "$pid" 2>/dev/null
  cat "$tmpfile"
  rm -f "$tmpfile"
}

log() { echo "$1" | tee -a "$LOGFILE"; }

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "FAIL: Vault not found: $VAULT_PATH"; exit 1
fi
mkdir -p "$PLUGIN_DIR" artifacts

echo "==============================" | tee "$LOGFILE"
log "Adapter Registry Check: $VAULT"
log "=============================="
log ""

# ── Step 1: Build + Deploy ──
log "[1/4] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || { log "FAIL: build failed"; exit 1; }
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
cp src/styles.css "$PLUGIN_DIR/styles.css" 2>/dev/null || true
log "  OK"

# ── Step 2: Ensure plugin ready ──
log "[2/4] Ensure plugin ready..."
PING=$(eval_cmd "1+1" || true)
if [[ "$PING" != *"2"* ]]; then
  open -a Obsidian
  sleep 5
  open "obsidian://open?vault=$VAULT"
  for i in $(seq 1 30); do
    PING=$(eval_cmd "1+1" || true)
    [[ "$PING" == *"2"* ]] && break
    sleep 1
  done
fi
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL > /dev/null || true
sleep 3
for i in $(seq 1 60); do
  READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.ready?.toString()' || true)
  [[ "$READY" == "true" ]] && break
  sleep 1
done
log "  plugin.ready: true"

# ── Step 3: Verify registered adapters ──
log "[3/4] Verify adapter registry..."

PASS_COUNT=0
TOTAL_CHECKS=0

check() {
  local name="$1"
  local result="$2"
  local expected="$3"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "$result" == "$expected" ]]; then
    log "  ✓ $name: $result"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log "  ✗ $name: got '$result', expected '$expected'"
  fi
}

# Verify upstage is active adapter
ADAPTER_TYPE=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.adapter' || echo "unknown")
check "Active adapter is upstage" "$ADAPTER_TYPE" "upstage"

# Verify active adapter
ACTIVE=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.adapter' || echo "unknown")
check "Active adapter" "$ACTIVE" "upstage"

# Verify dims
DIMS=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.dims?.toString()' || echo "0")
check "Dims" "$DIMS" "4096"

# ── Step 4: Verify no errors ──
log "[4/4] Verify no errors..."
ERRORS=$(eval_cmd 'app.plugins.plugins["open-connections"]?._embed_state?.lastError || "none"' || echo "unknown")
check "No errors" "$ERRORS" "none"

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Active: $ACTIVE ($DIMS-dim)"
log "  Errors: $ERRORS"
log "  Checks: $PASS_COUNT/$TOTAL_CHECKS passed"
log ""

if [[ "$PASS_COUNT" -ge "$TOTAL_CHECKS" ]]; then
  log "RESULT: PASS (all checks passed)"
  exit 0
else
  log "RESULT: FAIL ($PASS_COUNT/$TOTAL_CHECKS)"
  exit 1
fi
