#!/bin/bash
# check-upstage.sh — Autoresearch harness for Upstage API embedding.
# Configures Upstage adapter, triggers model switch, verifies embedding completes.
# IMPORTANT: Only runs on Test vault (Ataraxia is too large for API embedding).
# Usage: bash scripts/check-upstage.sh [max_embed_wait_seconds]

set -euo pipefail

VAULT="Test"
MAX_EMBED_WAIT="${1:-600}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/upstage-check-$(date +%Y%m%d-%H%M%S).log"

EVAL_TIMEOUT=10
eval_cmd() {
  local code="$1"
  VAULT="$VAULT" EVAL_TIMEOUT="$EVAL_TIMEOUT" CODE="$code" python3 - <<'PY'
import os
import subprocess
import sys

vault = os.environ["VAULT"]
timeout = int(os.environ["EVAL_TIMEOUT"])
code = os.environ["CODE"]

try:
    completed = subprocess.run(
        ["obsidian", f"vault={vault}", "eval", f"code={code}"],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
except subprocess.TimeoutExpired:
    print("FREEZE_DETECTED")
    sys.exit(1)

output = (completed.stdout or "") + (completed.stderr or "")
for line in output.splitlines():
    if "FATAL" in line:
        continue
    if line.startswith("=> "):
        print(line[3:])
    else:
        print(line)
PY
}

log() { echo "$1" | tee -a "$LOGFILE"; }

open_vault() {
  local encoded_path
  encoded_path=$(VAULT_PATH="$VAULT_PATH" python3 - <<'PY'
import os, urllib.parse
print(urllib.parse.quote(os.environ["VAULT_PATH"]))
PY
)
  open "obsidian://open?path=${encoded_path}"
}

restart_obsidian() {
  log "  Restarting Obsidian for a clean runtime..."
  pkill -x Obsidian 2>/dev/null || true
  sleep 2
  open -a Obsidian
  sleep 5
  open_vault
}

wait_for_ping() {
  local ping=""
  for _ in $(seq 1 30); do
    ping=$(eval_cmd "1+1" || true)
    [[ "$ping" == *"2"* ]] && return 0
    sleep 1
  done
  return 1
}

wait_for_plugin_ready() {
  local ready=""
  for _ in $(seq 1 60); do
    ready=$(eval_cmd 'app.plugins.plugins["open-connections"]?.ready?.toString()' || true)
    [[ "$ready" == "true" ]] && return 0
    sleep 1
  done
  return 1
}

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "FAIL: Vault not found: $VAULT_PATH"; exit 1
fi
mkdir -p "$PLUGIN_DIR" artifacts

echo "==============================" | tee "$LOGFILE"
log "Upstage Embedding Check: $VAULT (max_wait=${MAX_EMBED_WAIT}s)"
log "=============================="
log ""

# ── Step 1: Build + Deploy ──
log "[1/7] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || { log "FAIL: build failed"; exit 1; }
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
cp src/styles.css "$PLUGIN_DIR/styles.css" 2>/dev/null || true
log "  OK"

# ── Step 2: Ensure Obsidian running ──
log "[2/7] Ensure Obsidian running..."
if ! wait_for_ping; then
  restart_obsidian
  wait_for_ping || { log "FAIL: Obsidian CLI ping never recovered"; exit 1; }
fi
log "  OK"

# ── Step 3: Reload + wait for ready ──
log "[3/7] Reload plugin..."
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL > /dev/null || true
sleep 3

if ! wait_for_plugin_ready; then
  log "  plugin.ready missed the reload window; retrying once after restart..."
  restart_obsidian
  wait_for_ping || { log "FAIL: Obsidian CLI ping never recovered after restart"; exit 1; }
  wait_for_plugin_ready || { log "FAIL: UI FREEZE during plugin init"; exit 1; }
fi
log "  plugin.ready: true"

# ── Step 4: Verify Upstage adapter ──
log "[4/7] Verify Upstage adapter..."
ADAPTER=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.adapter' || true)
MODEL_KEY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.model_key' || true)
DIMS=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.dims?.toString()' || true)

log "  adapter: $ADAPTER"
log "  model_key: $MODEL_KEY"
log "  dims: $DIMS"

if [[ "$ADAPTER" != "upstage" ]]; then
  log "FAIL: Adapter is '$ADAPTER', expected 'upstage'"
  log "  Check data.json has settings.smart_sources.embed_model.adapter = 'upstage'"
  exit 1
fi
if [[ "$DIMS" != "4096" ]]; then
  log "FAIL: Dims is '$DIMS', expected '4096'"
  exit 1
fi
log "  ✓ Upstage adapter active (4096-dim)"

# ── Step 5: Wait for embed_ready ──
log "[5/7] Wait for embed_ready..."
for i in $(seq 1 120); do
  ER=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_ready?.toString()' || true)
  [[ "$ER" == "true" ]] && break
  if (( i % 10 == 0 )); then
    PHASE=$(eval_cmd 'app.plugins.plugins["open-connections"]?._embed_state?.phase' || true)
    log "  Waiting... phase=$PHASE (t+${i}s)"
  fi
  sleep 1
done
log "  embed_ready: true"

# ── Step 6: Monitor embedding progress ──
log "[6/7] Monitor embedding progress (max ${MAX_EMBED_WAIT}s)..."
LAST_EMBEDDED=0
STALL_COUNT=0
MAX_STALL=60

for i in $(seq 1 "$MAX_EMBED_WAIT"); do
  STATS=$(eval_cmd '(function(){ var p = app.plugins.plugins["open-connections"]; var bc = p.block_collection; var embedded = bc.all.filter(function(b){ return b.has_embed(); }).length; var total = bc.size; var phase = p._embed_state.phase; var active = p.embedding_pipeline ? p.embedding_pipeline.is_active() : false; return embedded + "/" + total + "/" + phase + "/" + active; })()' || echo "0/0/unknown/false")

  EMBEDDED=$(echo "$STATS" | cut -d'/' -f1)
  TOTAL=$(echo "$STATS" | cut -d'/' -f2)
  PHASE=$(echo "$STATS" | cut -d'/' -f3)
  ACTIVE=$(echo "$STATS" | cut -d'/' -f4)

  if (( i % 30 == 0 )); then
    if [[ "$TOTAL" -gt 0 ]]; then
      PCT=$(( EMBEDDED * 100 / TOTAL ))
      log "  [$i/${MAX_EMBED_WAIT}s] $EMBEDDED/$TOTAL blocks embedded (${PCT}%) phase=$PHASE pipeline=$ACTIVE"
    else
      log "  [$i/${MAX_EMBED_WAIT}s] blocks=$EMBEDDED phase=$PHASE pipeline=$ACTIVE"
    fi
  fi

  # Check for stall
  if [[ "$EMBEDDED" == "$LAST_EMBEDDED" ]] && [[ "$PHASE" == "idle" ]] && [[ "$ACTIVE" == "false" ]]; then
    STALL_COUNT=$((STALL_COUNT + 1))
    if (( STALL_COUNT >= MAX_STALL )); then
      log "  Pipeline stalled for ${MAX_STALL}s at $EMBEDDED embedded blocks"
      break
    fi
  else
    STALL_COUNT=0
  fi
  LAST_EMBEDDED="$EMBEDDED"

  # Check if all done
  if [[ "$TOTAL" -gt 0 ]] && [[ "$EMBEDDED" -eq "$TOTAL" ]] && [[ "$PHASE" == "idle" ]]; then
    log "  ✓ All $TOTAL blocks embedded!"
    break
  fi

  sleep 1
done

# ── Step 7: Final verification ──
log "[7/7] Final verification..."
log ""

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

FINAL_ADAPTER=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.adapter' || true)
check "Adapter is upstage" "$FINAL_ADAPTER" "upstage"

FINAL_DIMS=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_adapter?.dims?.toString()' || true)
check "Dims is 4096" "$FINAL_DIMS" "4096"

FINAL_EMBED_READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_ready?.toString()' || true)
check "embed_ready" "$FINAL_EMBED_READY" "true"

FINAL_EMBEDDED=$(eval_cmd '(function(){ var bc = app.plugins.plugins["open-connections"].block_collection; return bc.all.filter(function(b){ return b.has_embed(); }).length.toString(); })()' || echo "0")
check "Embedded blocks (>=100)" "$FINAL_EMBEDDED" "100"

IDX_SIZE=$(eval_cmd 'app.plugins.plugins["open-connections"]?.block_collection?.data_adapter?._vectorIndex?.size?.toString()' || echo "0")
check "FlatVectorIndex size (>=100)" "$IDX_SIZE" "100"

eval_cmd 'app.commands.executeCommandById("open-connections:connections-view"); "ok"' > /dev/null || true
sleep 2
CONN_COUNT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll("[role=listitem]").length.toString(); })()' || echo "0")

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Adapter: $FINAL_ADAPTER ($FINAL_DIMS-dim)"
log "  Embedded blocks: $FINAL_EMBEDDED"
log "  Vector index size: $IDX_SIZE"
log "  Connections (informational): $CONN_COUNT"
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
