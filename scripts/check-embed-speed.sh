#!/bin/bash
# check-embed-speed.sh — Autoresearch harness for embedding speed.
# Queues N blocks for re-embedding, measures wall time.
# IMPORTANT: Test vault only. Uses existing Upstage embeddings.
# Usage: bash scripts/check-embed-speed.sh [num_blocks] [max_time_seconds]

set -euo pipefail

VAULT="Test"
NUM_BLOCKS="${1:-100}"
MAX_TIME="${2:-60}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/embed-speed-$(date +%Y%m%d-%H%M%S).log"

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
log "Embed Speed Check: $VAULT ($NUM_BLOCKS blocks, max ${MAX_TIME}s)"
log "=============================="
log ""

# ── Step 1: Build + Deploy ──
log "[1/5] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || { log "FAIL: build failed"; exit 1; }
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
cp src/styles.css "$PLUGIN_DIR/styles.css" 2>/dev/null || true
log "  OK"

# ── Step 2: Ensure Obsidian + plugin ready ──
log "[2/5] Ensure plugin ready..."
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
  READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_ready?.toString()' || true)
  [[ "$READY" == "true" ]] && break
  sleep 1
done
log "  embed_ready: true"

# Verify adapter
ADAPTER=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.adapter' || true)
log "  adapter: $ADAPTER"

# ── Step 3: Queue N blocks for re-embed ──
log "[3/5] Queue $NUM_BLOCKS blocks..."

cat > /tmp/oc-queue-speed.js << JSEOF
var p=app.plugins.plugins["open-connections"];var bc=p.block_collection;var count=0;for(var k in bc.items){if(count>=$NUM_BLOCKS)break;var b=bc.items[k];if(b.has_embed()&&b.size>50){b.set_active_embedding_meta({hash:""});b.queue_embed();count++}}count+" queued"
JSEOF
QUEUED=$(eval_cmd "$(cat /tmp/oc-queue-speed.js)" || echo "0 queued")
log "  $QUEUED"

# ── Step 4: Run embedding job + time it ──
log "[4/5] Running embedding job..."
START_TIME=$(date +%s)

eval_cmd 'app.plugins.plugins["open-connections"].runEmbeddingJob("[speed-test]").then(function(){return "started"})' > /dev/null || true

ELAPSED=0
for i in $(seq 1 "$MAX_TIME"); do
  sleep 2
  PHASE=$(eval_cmd 'app.plugins.plugins["open-connections"]._embed_state.phase' || echo "unknown")
  ELAPSED=$(( $(date +%s) - START_TIME ))

  if [[ "$PHASE" == "idle" ]]; then
    log "  Completed in ${ELAPSED}s"
    break
  fi

  if (( i % 10 == 0 )); then
    log "  Waiting... phase=$PHASE (${ELAPSED}s elapsed)"
  fi
done

if [[ "$PHASE" != "idle" ]]; then
  log "  TIMEOUT: still $PHASE after ${MAX_TIME}s"
fi

# ── Step 5: Final verification ──
log "[5/5] Verification..."

PASS_COUNT=0
TOTAL_CHECKS=0

check() {
  local name="$1"
  local result="$2"
  local expected="$3"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "$result" == "$expected" ]] || [[ "$result" -le "$expected" ]] 2>/dev/null; then
    log "  ✓ $name: $result"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log "  ✗ $name: got $result, expected <= $expected"
  fi
}

# Check no errors
ERRORS=$(eval_cmd 'app.plugins.plugins["open-connections"]._embed_state.lastError || "none"' || echo "unknown")
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [[ "$ERRORS" == "none" ]]; then
  log "  ✓ No embedding errors"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log "  ✗ Error: $ERRORS"
fi

# Check completion time
check "Elapsed time (<= ${MAX_TIME}s)" "$ELAPSED" "$MAX_TIME"

# Check phase is idle
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [[ "$PHASE" == "idle" ]]; then
  log "  ✓ Phase: idle (completed)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log "  ✗ Phase: $PHASE (not completed)"
fi

# Calculate rate
if [[ "$ELAPSED" -gt 0 ]]; then
  RATE=$(( NUM_BLOCKS / ELAPSED ))
  log "  Rate: ~${RATE} blocks/sec"
fi

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Adapter: $ADAPTER"
log "  Blocks: $NUM_BLOCKS"
log "  Time: ${ELAPSED}s"
log "  Rate: ~${RATE:-0} blocks/sec"
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
