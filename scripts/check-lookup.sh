#!/bin/bash
# check-lookup.sh — Autoresearch harness for Smart Lookup View.
# Opens lookup, runs a search query, verifies results render.
# Usage: bash scripts/check-lookup.sh [vault_name] [poll_timeout]

set -euo pipefail

VAULT="${1:-Test}"
POLL_TIMEOUT="${2:-30}"
PLUGIN="open-connections"
VAULT_PATH="$HOME/Documents/01. Obsidian/$VAULT"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
LOGFILE="artifacts/lookup-check-$(date +%Y%m%d-%H%M%S).log"

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
log "Lookup View Check: $VAULT (poll=${POLL_TIMEOUT}s)"
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

# ── Step 3: Reload + wait for embed_ready ──
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

# ── Step 4: Open lookup view ──
log "[4/5] Open lookup view..."
eval_cmd 'app.commands.executeCommandById("open-connections:open-lookup-view"); "ok"' > /dev/null || true
sleep 1
log "  OK"

# ── Step 5: Run search queries ──
log "[5/5] Testing search queries..."

QUERIES=("productivity" "obsidian" "programming")
PASS_COUNT=0

for QUERY in "${QUERIES[@]}"; do
  log ""
  log "  --- Query: '$QUERY' ---"

  # Trigger search via eval
  SEARCH_RESULT=$(eval_cmd "(function(){ var leaf = app.workspace.getLeavesOfType('open-connections-lookup')[0]; if (!leaf) return 'no_view'; var view = leaf.view; view.searchInput.value = '$QUERY'; view.performSearch('$QUERY'); return 'searching'; })()" || echo "error")

  if [[ "$SEARCH_RESULT" == "no_view" ]]; then
    log "  ✗ Lookup view not found"
    continue
  fi

  # Poll for results
  FOUND=false
  for j in $(seq 1 $((POLL_TIMEOUT / 2))); do
    sleep 2
    RESULT=$(eval_cmd '(function(){ var leaf = app.workspace.getLeavesOfType("open-connections-lookup")[0]; if (!leaf) return "0"; return leaf.view.containerEl.querySelectorAll(".osc-lookup-result").length.toString(); })()' || echo "0")

    if [[ "$RESULT" == "FREEZE_DETECTED" ]]; then
      log "  FREEZE polling results"
      break
    fi

    if [[ "$RESULT" -gt 0 ]]; then
      log "  ✓ $RESULT results after $((j*2))s"
      PASS_COUNT=$((PASS_COUNT + 1))
      FOUND=true
      break
    fi
  done

  if [[ "$FOUND" == "false" ]]; then
    log "  ✗ 0 results after ${POLL_TIMEOUT}s"
  fi
done

# ── Final Report ──
log ""
log "=============================="
log "FINAL REPORT"
log "=============================="
log "  Queries tested: ${#QUERIES[@]}"
log "  Queries with results: $PASS_COUNT"
log ""

if [[ "$PASS_COUNT" -ge 2 ]]; then
  log "RESULT: PASS ($PASS_COUNT/${#QUERIES[@]} queries return results)"
  exit 0
elif [[ "$PASS_COUNT" -ge 1 ]]; then
  log "RESULT: PARTIAL ($PASS_COUNT/${#QUERIES[@]})"
  exit 1
else
  log "RESULT: FAIL (0/${#QUERIES[@]} queries return results)"
  exit 1
fi
