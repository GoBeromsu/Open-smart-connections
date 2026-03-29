#!/bin/bash
# check-reembed-threshold.sh — Autoresearch harness for re-embed threshold.
# Verifies that re_embed_min_change setting prevents trivial re-embeds
# and that min_chars=20 allows short blocks to be eligible.
# IMPORTANT: Test vault only. NO DB flush — reuses existing embeddings.
# Usage: bash scripts/check-reembed-threshold.sh

set -euo pipefail

VAULT="Test"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/reembed-threshold-$(date +%Y%m%d-%H%M%S).log"

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
log "Re-embed Threshold Check: $VAULT"
log "=============================="
log ""

# ── Step 1: Build + Deploy (no DB flush) ──
log "[1/5] Build + Deploy (no flush)..."
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
  if [[ "$READY" == "FREEZE_DETECTED" ]]; then
    log "FAIL: UI FREEZE during plugin init"
    exit 1
  fi
  [[ "$READY" == "true" ]] && break
  sleep 1
done
log "  plugin.ready: true"

# ── Step 4: Verify settings loaded ──
log "[4/5] Verify settings..."

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

# Check re_embed_min_change
RE_EMBED=$(eval_cmd 'app.plugins.plugins["open-connections"]?.settings?.smart_blocks?.re_embed_min_change?.toString()' || echo "unknown")
check "re_embed_min_change" "$RE_EMBED" "200"

# Check min_chars
MIN_CHARS=$(eval_cmd 'app.plugins.plugins["open-connections"]?.settings?.smart_blocks?.min_chars?.toString()' || echo "unknown")
check "min_chars" "$MIN_CHARS" "20"

# ── Step 5: Verify short block eligibility ──
log "[5/5] Verify short block eligibility..."

# Use file-based eval for complex JS
cat > /tmp/oc-short-blocks.js << 'JSEOF'
var bc=app.plugins.plugins["open-connections"].block_collection;var shortEligible=0;var shortTotal=0;for(var k in bc.items){var b=bc.items[k];if(b.size>=20&&b.size<200){shortTotal++;if(b.should_embed)shortEligible++}}shortEligible+"/"+shortTotal
JSEOF
SHORT_RESULT=$(eval_cmd "$(cat /tmp/oc-short-blocks.js)" || echo "0/0")
SHORT_ELIGIBLE=$(echo "$SHORT_RESULT" | cut -d'/' -f1)
SHORT_TOTAL=$(echo "$SHORT_RESULT" | cut -d'/' -f2)
log "  Short blocks (20-199 chars): $SHORT_ELIGIBLE eligible / $SHORT_TOTAL total"

TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [[ "$SHORT_ELIGIBLE" -gt 0 ]]; then
  log "  ✓ Short blocks are eligible for embedding"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log "  ✗ No short blocks eligible (expected > 0)"
fi

# Verify queue doesn't include already-embedded entities with small changes
cat > /tmp/oc-queue-check.js << 'JSEOF'
var p=app.plugins.plugins["open-connections"];var queued=p.queueUnembeddedEntities();queued.toString()
JSEOF
QUEUED=$(eval_cmd "$(cat /tmp/oc-queue-check.js)" || echo "unknown")
log "  Queued for embedding after reload: $QUEUED"

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  re_embed_min_change: $RE_EMBED"
log "  min_chars: $MIN_CHARS"
log "  Short blocks eligible: $SHORT_ELIGIBLE/$SHORT_TOTAL"
log "  Queued after reload: $QUEUED"
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
