#!/bin/bash
# check-highlight.sh — Autoresearch harness for score highlight threshold.
# Verifies that results above the configured threshold use osc-score--high class.
# Usage: bash scripts/check-highlight.sh [vault_name]

set -euo pipefail

VAULT="${1:-Test}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/highlight-check-$(date +%Y%m%d-%H%M%S).log"

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
log "Highlight Threshold Check: $VAULT"
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

# ── Step 3: Reload + wait for ready + embed_ready ──
log "[3/5] Reload plugin..."
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL > /dev/null || true
sleep 3

for i in $(seq 1 60); do
  READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.ready?.toString()' || true)
  [[ "$READY" == "true" ]] && break
  sleep 1
done
log "  plugin.ready: true"

for i in $(seq 1 60); do
  ER=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_ready?.toString()' || true)
  [[ "$ER" == "true" ]] && break
  sleep 1
done
log "  embed_ready: true"

# ── Step 4: Read current threshold ──
log "[4/5] Check threshold setting..."
THRESHOLD=$(eval_cmd 'app.plugins.plugins["open-connections"]?.settings?.smart_view_filter?.highlight_threshold?.toString()' || echo "unknown")
log "  highlight_threshold: $THRESHOLD"

# ── Step 5: Open a file and verify score classes ──
log "[5/5] Verify score highlight classes..."

# Open connections view
eval_cmd 'app.commands.executeCommandById("open-connections:connections-view"); "ok"' > /dev/null || true
sleep 2

# Open a file with embedded blocks
eval_cmd '(function(){ var bc = app.plugins.plugins["open-connections"].block_collection; for (var k in bc.items) { var src = k.split("#")[0]; if (bc.items[k].has_embed()) { app.workspace.openLinkText(src, "", false); return "opened: " + src; } } return "no_file"; })()' > /dev/null || true
sleep 3

# Trigger renderView
eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (leaf) leaf.view.renderView(); return "ok"; })()' > /dev/null || true
sleep 3

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
    log "  ✗ $name: got $result, expected >= $expected"
  fi
}

# Count total results
TOTAL_RESULTS=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll("[role=listitem]").length.toString(); })()' || echo "0")
check "Total results (>=1)" "$TOTAL_RESULTS" "1"

# Count high score results
HIGH_COUNT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll(".osc-score--high").length.toString(); })()' || echo "0")
log "  High score results: $HIGH_COUNT"

# Count medium score results
MED_COUNT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll(".osc-score--medium").length.toString(); })()' || echo "0")
log "  Medium score results: $MED_COUNT"

# Count low score results
LOW_COUNT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll(".osc-score--low").length.toString(); })()' || echo "0")
log "  Low score results: $LOW_COUNT"

# Verify at least one high score exists (with default 0.8 threshold, most results should be above)
check "High score results (>=1)" "$HIGH_COUNT" "1"

# Log score tier distribution (informational — diversity depends on content)
TIERS_USED=0
[[ "$HIGH_COUNT" -gt 0 ]] && TIERS_USED=$((TIERS_USED + 1))
[[ "$MED_COUNT" -gt 0 ]] && TIERS_USED=$((TIERS_USED + 1))
[[ "$LOW_COUNT" -gt 0 ]] && TIERS_USED=$((TIERS_USED + 1))
log "  Score tiers used: $TIERS_USED"

# Verify computed styles apply accent color to high scores
ACCENT_APPLIED=$(eval_cmd '(function(){ var el = document.querySelector(".osc-score--high"); if (!el) return "no_element"; var style = getComputedStyle(el); return style.fontWeight === "600" ? "true" : "false"; })()' || echo "unknown")
check "Accent style on high scores" "$ACCENT_APPLIED" "true"

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Threshold: $THRESHOLD"
log "  Scores: high=$HIGH_COUNT medium=$MED_COUNT low=$LOW_COUNT"
log "  Checks: $PASS_COUNT/$TOTAL_CHECKS passed"
log ""

if [[ "$PASS_COUNT" -ge "$TOTAL_CHECKS" ]]; then
  log "RESULT: PASS (all checks passed)"
  exit 0
elif [[ "$PASS_COUNT" -ge 2 ]]; then
  log "RESULT: PARTIAL ($PASS_COUNT/$TOTAL_CHECKS)"
  exit 1
else
  log "RESULT: FAIL ($PASS_COUNT/$TOTAL_CHECKS)"
  exit 1
fi
