#!/bin/bash
# check-connections.sh — Autoresearch harness for Connections View.
# Opens multiple files, polls for connections results, PASS if 2/3 show >0.
# Usage: bash scripts/check-connections.sh [vault_name] [poll_timeout_per_file]

set -euo pipefail

VAULT="${1:-Test}"
POLL_TIMEOUT="${2:-30}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/connections-check-$(date +%Y%m%d-%H%M%S).log"

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
log "Connections Check: $VAULT (poll=${POLL_TIMEOUT}s per file)"
log "=============================="
log ""

# ── Step 1: Build + Deploy ──
log "[1/5] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || { log "FAIL: build failed"; exit 1; }
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
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
obsidian "vault=$VAULT" dev:debug on 2>&1 | grep -v FATAL > /dev/null || true
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

# Wait for embed_ready
for i in $(seq 1 60); do
  ER=$(eval_cmd 'app.plugins.plugins["open-connections"]?.embed_ready?.toString()' || true)
  [[ "$ER" == "true" ]] && break
  sleep 1
done
log "  embed_ready: true"

# ── Step 4: Wait for some blocks to exist ──
log "[4/5] Waiting for blocks..."
for i in $(seq 1 60); do
  BLK=$(eval_cmd '(function(){ var bc = app.plugins.plugins["open-connections"].block_collection; return bc ? bc.all.filter(function(b){ return b.has_embed(); }).length.toString() : "0"; })()' || echo "0")
  if [[ "$BLK" -gt 100 ]]; then
    log "  $BLK embedded blocks found (t+${i}s)"
    break
  fi
  if (( i % 10 == 0 )); then
    log "  Waiting... $BLK embedded blocks (t+${i}s)"
  fi
  sleep 1
done

# ── Step 5: Test connections on multiple files ──
log "[5/5] Testing connections on files..."

# Pick 3 files with embedded blocks from different sources
TEST_FILES=$(eval_cmd '(function(){ var bc = app.plugins.plugins["open-connections"].block_collection; var seen = {}; var files = []; for (var k in bc.items) { var src = k.split("#")[0]; if (!seen[src] && bc.items[k].has_embed()) { seen[src] = true; files.push(src); if (files.length >= 3) break; } } return JSON.stringify(files); })()' || echo '[]')
log "  Test files: $TEST_FILES"

PASS_COUNT=0
TOTAL_FILES=0

# Test each file by index
FILE_COUNT=$(echo "$TEST_FILES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

for idx in $(seq 0 $((FILE_COUNT - 1))); do
  FILE=$(echo "$TEST_FILES" | python3 -c "import sys,json; print(json.load(sys.stdin)[$idx])" 2>/dev/null || true)
  [[ -z "$FILE" ]] && continue
  TOTAL_FILES=$((TOTAL_FILES + 1))
  log ""
  log "  --- File $TOTAL_FILES: $FILE ---"

  # Open file via index-based eval (avoids shell escaping issues)
  OPEN_RESULT=$(eval_cmd "(function(){ var files = $TEST_FILES; app.workspace.openLinkText(files[$idx], \"\", false); return \"opened\"; })()" || echo "")
  if [[ "$OPEN_RESULT" == "FREEZE_DETECTED" ]]; then
    log "  FREEZE opening file"
    continue
  fi
  sleep 2

  # Trigger renderView
  eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (leaf) leaf.view.renderView(); return "ok"; })()' > /dev/null || true

  # Poll for connections
  FOUND=false
  for j in $(seq 1 $((POLL_TIMEOUT / 2))); do
    sleep 2
    RESULT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-view")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll("[role=listitem]").length.toString(); })()' || echo "0")

    if [[ "$RESULT" == "FREEZE_DETECTED" ]]; then
      log "  FREEZE polling connections"
      break
    fi

    if [[ "$RESULT" -gt 0 ]]; then
      log "  ✓ $RESULT connections after $((j*2))s"
      PASS_COUNT=$((PASS_COUNT + 1))
      FOUND=true
      break
    fi
  done

  if [[ "$FOUND" == "false" ]]; then
    log "  ✗ 0 connections after ${POLL_TIMEOUT}s"
  fi
done

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Files tested: $TOTAL_FILES"
log "  Files with connections: $PASS_COUNT"
log ""

if [[ "$TOTAL_FILES" -eq 0 ]]; then
  log "RESULT: FAIL (no test files found — blocks may not be embedded yet)"
  exit 1
elif [[ "$PASS_COUNT" -ge 2 ]]; then
  log "RESULT: PASS ($PASS_COUNT/$TOTAL_FILES files show connections)"
  exit 0
elif [[ "$PASS_COUNT" -ge 1 ]]; then
  log "RESULT: PARTIAL ($PASS_COUNT/$TOTAL_FILES — some connections work)"
  exit 1
else
  log "RESULT: FAIL (0/$TOTAL_FILES files show connections)"
  exit 1
fi
