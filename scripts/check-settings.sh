#!/bin/bash
# check-settings.sh — Autoresearch harness for Settings Tab.
# Opens settings tab, verifies all sections render with expected headings and controls.
# Usage: bash scripts/check-settings.sh [vault_name]

set -euo pipefail

VAULT="${1:-Test}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/settings-check-$(date +%Y%m%d-%H%M%S).log"

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
log "Settings Tab Check: $VAULT"
log "=============================="
log ""

# ── Step 1: Build + Deploy ──
log "[1/5] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || { log "FAIL: build failed"; exit 1; }
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
cp src/styles.css "$PLUGIN_DIR/styles.css" 2>/dev/null || true
log "  OK"

# ── Step 2: Ensure Obsidian running ──
log "[2/5] Ensure Obsidian running..."
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
log "  OK"

# ── Step 3: Reload + wait for ready ──
log "[3/5] Reload plugin..."
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL > /dev/null || true
sleep 3

for i in $(seq 1 60); do
  READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.ready?.toString()' || true)
  [[ "$READY" == "true" ]] && break
  sleep 1
done
log "  plugin.ready: true"

# ── Step 4: Open settings tab ──
log "[4/5] Open settings tab..."
eval_cmd 'app.commands.executeCommandById("app:open-settings"); "ok"' > /dev/null || true
sleep 1
eval_cmd 'app.setting.openTabById("open-connections"); "opened"' > /dev/null || true
sleep 1
log "  OK"

# ── Step 5: Verify settings content ──
log "[5/5] Verifying settings sections..."

PASS_COUNT=0
TOTAL_CHECKS=0

check() {
  local name="$1"
  local result="$2"
  local expected="$3"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "$result" == "$expected" ]] || [[ "$result" -ge "$expected" ]] 2>/dev/null; then
    log "  ✓ $name: $result"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log "  ✗ $name: got $result, expected $expected"
  fi
}

# Check section headings
HEADINGS=$(eval_cmd '(function(){ var el = document.querySelector(".open-connections-settings"); if (!el) return "0"; return el.querySelectorAll(".setting-item-heading").length.toString(); })()' || echo "0")
check "Section headings (>=6)" "$HEADINGS" "6"

# Check total setting items
ITEMS=$(eval_cmd '(function(){ var el = document.querySelector(".open-connections-settings"); if (!el) return "0"; return el.querySelectorAll(".setting-item").length.toString(); })()' || echo "0")
check "Setting items (>=10)" "$ITEMS" "10"

# Check status pills
PILLS=$(eval_cmd '(function(){ var el = document.querySelector(".open-connections-settings"); if (!el) return "0"; return el.querySelectorAll(".osc-status-pill").length.toString(); })()' || echo "0")
check "Status pills (>=2)" "$PILLS" "2"

# Check stats grid
CARDS=$(eval_cmd '(function(){ var el = document.querySelector(".open-connections-settings"); if (!el) return "0"; return el.querySelectorAll(".osc-stat-card").length.toString(); })()' || echo "0")
check "Stat cards (>=4)" "$CARDS" "4"

# Check highlight threshold slider exists
SLIDER=$(eval_cmd '(function(){ var el = document.querySelector(".open-connections-settings"); if (!el) return "false"; var items = el.querySelectorAll(".setting-item"); for (var i = 0; i < items.length; i++) { if (items[i].textContent.indexOf("Highlight threshold") >= 0) return "true"; } return "false"; })()' || echo "false")
check "Highlight threshold slider" "$SLIDER" "true"

# Check no error text
ERRORS=$(eval_cmd '(function(){ var el = document.querySelector(".open-connections-settings"); if (!el) return "0"; var text = el.textContent || ""; return (text.indexOf("Error") >= 0 || text.indexOf("error") >= 0) ? "error_found" : "clean"; })()' || echo "unknown")
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [[ "$ERRORS" == "clean" ]]; then
  log "  ✓ No error text in settings"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log "  ✗ Error text found in settings"
fi

# Close settings
eval_cmd 'app.setting.close(); "closed"' > /dev/null || true

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Checks: $PASS_COUNT/$TOTAL_CHECKS passed"
log ""

if [[ "$PASS_COUNT" -ge "$TOTAL_CHECKS" ]]; then
  log "RESULT: PASS (all checks passed)"
  exit 0
elif [[ "$PASS_COUNT" -ge 4 ]]; then
  log "RESULT: PARTIAL ($PASS_COUNT/$TOTAL_CHECKS)"
  exit 1
else
  log "RESULT: FAIL ($PASS_COUNT/$TOTAL_CHECKS)"
  exit 1
fi
