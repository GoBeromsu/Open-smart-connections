#!/bin/bash
# check-e2e.sh — End-to-end verification harness.
# Verifies: plugin loads → sources discovered → embedding completes → Connections View shows results
# Usage: bash scripts/check-e2e.sh [vault_name] [max_wait_seconds]

set -euo pipefail

VAULT="${1:-Test}"
MAX_WAIT="${2:-300}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/e2e-check-$(date +%Y%m%d-%H%M%S).log"

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
log "E2E Check: $VAULT (max_wait=${MAX_WAIT}s)"
log "=============================="
log ""

# ── Step 1: Build + Deploy ──
log "[1/7] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || { log "FAIL: build failed"; exit 1; }
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
log "  OK (build + deploy)"

# ── Step 2: Ensure Obsidian running ──
log "[2/7] Ensure Obsidian running..."
PING=$(eval_cmd "1+1" || true)
if [[ "$PING" != *"2"* ]]; then
  open -a Obsidian
  sleep 5
  ENCODED_PATH=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$VAULT_PATH'))")
  open "obsidian://open?path=$ENCODED_PATH"
  for i in $(seq 1 30); do
    PING=$(eval_cmd "1+1" || true)
    [[ "$PING" == *"2"* ]] && break
    sleep 1
  done
fi
log "  OK"

# ── Step 3: Reload plugin + enable debug ──
log "[3/7] Reload plugin..."
obsidian "vault=$VAULT" dev:debug on 2>&1 | grep -v FATAL > /dev/null || true
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL > /dev/null || true
sleep 3

# Wait for plugin.ready (detect freeze via timeout)
for i in $(seq 1 60); do
  READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.ready?.toString()' || true)
  if [[ "$READY" == "FREEZE_DETECTED" ]]; then
    log "FAIL: UI FREEZE detected during plugin init"
    exit 1
  fi
  [[ "$READY" == "true" ]] && break
  sleep 1
done
READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.ready?.toString()' || true)
log "  plugin.ready: $READY"
if [[ "$READY" != "true" ]]; then
  log "FAIL: plugin did not become ready (possible freeze)"
  exit 1
fi

# ── Step 4: Check source discovery ──
log "[4/7] Check sources..."
SRC_COUNT=$(eval_cmd '(function(){ var sc = app.plugins.plugins["open-connections"].source_collection; return Object.keys(sc.items).length; })()' || echo "0")
log "  sources: $SRC_COUNT"
if [[ "$SRC_COUNT" == "0" ]]; then
  log "FAIL: no sources discovered"
  exit 1
fi

# ── Step 5: Wait for plugin init to settle ──
log "[5/7] Waiting for plugin init..."

# Wait for embed_ready (Phase 2 complete)
STARTED=$(date +%s)
for i in $(seq 1 120); do
  NOW=$(date +%s)
  ELAPSED=$((NOW - STARTED))
  READY=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_ready?.toString()' || true)
  if [[ "$READY" == "true" ]]; then
    log "  embed_ready after ${ELAPSED}s"
    break
  fi
  if (( i % 10 == 0 )); then
    log "  Waiting for embed_ready... (${ELAPSED}s)"
  fi
  sleep 1
done

# ── Step 6: Check Connections View ──
log "[6/7] Check Connections View..."

# Open a markdown file to trigger lazy block import + auto-embed
OPENED=$(eval_cmd '(function(){ var files = app.vault.getMarkdownFiles().filter(function(f){ return f.stat.size > 500; }); if (files.length === 0) return "no_files"; app.workspace.openLinkText(files[0].path, "", false); return files[0].path; })()' || echo "")

if [[ "$OPENED" == "FREEZE_DETECTED" ]]; then
  log "  FREEZE detected when opening file"
  CONN_RESULT='{"error":"freeze"}'
else
  log "  Opened: $OPENED"
  # Trigger renderView to start the lazy block import + auto-embed cycle
  sleep 2
  eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (leaf) leaf.view.renderView(); return "ok"; })()' || true

  # Wait up to 30s for connections to appear (auto-embed cycle: import blocks → embed → re-render)
  CONN_RESULT='{"count":0}'
  for i in $(seq 1 15); do
    sleep 2
    RESULT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return JSON.stringify({error: "no_leaf"}); var view = leaf.view; return JSON.stringify({count: view.results ? view.results.length : 0, file: app.workspace.getActiveFile() ? app.workspace.getActiveFile().path : "none"}); })()' || echo '{}')

    if [[ "$RESULT" == "FREEZE_DETECTED" ]]; then
      log "  FREEZE detected during connections check"
      CONN_RESULT='{"error":"freeze","count":0}'
      break
    fi

    COUNT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('count',0))" 2>/dev/null || echo "0")
    if [[ "$COUNT" -gt 0 ]]; then
      CONN_RESULT="$RESULT"
      log "  Connections found after $((i*2))s: $RESULT"
      break
    fi

    if (( i % 5 == 0 )); then
      log "  Waiting for auto-embed cycle... ($((i*2))s)"
    fi
  done
fi
log "  Connections: $CONN_RESULT"
log "  Connections: $CONN_RESULT"

# ── Step 7: GPU diagnostics ──
log "[7/7] GPU diagnostics..."
GPU_DIAG=$(eval_cmd 'app.plugins.plugins["open-connections"].embed_adapter.get_gpu_diag().then(function(d){ return JSON.stringify(d); }).catch(function(e){ return JSON.stringify({error: e.message}); })' || echo '{}')
log "  GPU: $GPU_DIAG"

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="

# Parse results
CONN_COUNT=$(echo "$CONN_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('count',0))" 2>/dev/null || echo "0")
BACKEND=$(echo "$GPU_DIAG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('backend','unknown'))" 2>/dev/null || echo "unknown")

FINAL_STATE=$(eval_cmd '(function(){ var p = app.plugins.plugins["open-connections"]; var sc = p.source_collection; var bc = p.block_collection; var src_keys = Object.keys(sc.items); var blk_keys = Object.keys(bc.items); var src_emb = sc.all.filter(function(s){ return s.has_embed(); }).length; var blk_emb = bc.all.filter(function(b){ return b.has_embed(); }).length; return JSON.stringify({sources: src_keys.length, blocks: blk_keys.length, src_embedded: src_emb, blk_embedded: blk_emb}); })()' || echo '{}')
log "  Entities: $FINAL_STATE"
log "  Connections: count=$CONN_COUNT"
log "  Backend: $BACKEND"
log ""

# Determine PASS/FAIL
SRC_EMB_FINAL=$(echo "$FINAL_STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('src_embedded',0))" 2>/dev/null || echo "0")
BLK_EMB_FINAL=$(echo "$FINAL_STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('blk_embedded',0))" 2>/dev/null || echo "0")

PASS=true
FAILURES=""

if [[ "$SRC_EMB_FINAL" -eq 0 && "$BLK_EMB_FINAL" -eq 0 ]]; then
  PASS=false
  FAILURES="${FAILURES}\n  - No entities embedded"
fi

if [[ "$CONN_COUNT" -eq 0 ]]; then
  PASS=false
  FAILURES="${FAILURES}\n  - Connections View has 0 results"
fi

if [[ "$BACKEND" != "webgpu" ]]; then
  FAILURES="${FAILURES}\n  - WebGPU not active (backend=$BACKEND)"
fi

if [[ "$PASS" == "true" ]]; then
  log "RESULT: PASS"
  log "  Embedding: ${SRC_EMB_FINAL} sources + ${BLK_EMB_FINAL} blocks"
  log "  Connections: ${CONN_COUNT} results"
  log "  Backend: ${BACKEND}"
  exit 0
else
  log "RESULT: FAIL"
  echo -e "$FAILURES" | tee -a "$LOGFILE"
  exit 1
fi
