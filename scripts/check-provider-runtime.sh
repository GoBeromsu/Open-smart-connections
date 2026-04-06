#!/bin/bash
# check-provider-runtime.sh — Bounded Test-vault runtime smoke check for the
# currently configured provider, with optional expected adapter/model assertions.
# Usage:
#   bash scripts/check-provider-runtime.sh [expected_adapter] [expected_model_key] [expected_dims]
# Example:
#   bash scripts/check-provider-runtime.sh upstage embedding-passage 4096

set -euo pipefail

VAULT="${OC_TEST_VAULT:-Test}"
PLUGIN="open-connections"
VAULT_PATH="${OBSIDIAN_VAULT_PATH:-$HOME/Documents/01. Obsidian/$VAULT}"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN"
EXPECTED_ADAPTER="${1:-}"
EXPECTED_MODEL_KEY="${2:-}"
EXPECTED_DIMS="${3:-}"
LOGFILE="artifacts/provider-runtime-$(date +%Y%m%d-%H%M%S).log"

EVAL_TIMEOUT=10

mkdir -p "$PLUGIN_DIR" artifacts

fail() {
  echo "FAIL: $1" | tee -a "$LOGFILE"
  exit 1
}

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
    ping=$(eval_cmd '1+1' || true)
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

sanitize_dev_output() {
  printf '%s' "$1" \
    | grep -v -E '^(No errors captured\.?|No console messages captured\.?|Error: Debugger not attached\..*)$' \
    || true
}

if [[ ! -d "$VAULT_PATH" ]]; then
  fail "Vault not found: $VAULT_PATH"
fi

echo "==============================" | tee "$LOGFILE"
log "Provider Runtime Check: $VAULT"
log "=============================="
log "Expected adapter: ${EXPECTED_ADAPTER:-<any>}"
log "Expected model: ${EXPECTED_MODEL_KEY:-<any>}"
log "Expected dims: ${EXPECTED_DIMS:-<any>}"
log ""

log "[1/4] Build + Deploy..."
pnpm run build > /dev/null 2>&1 || fail "build failed"
cp dist/main.js "$PLUGIN_DIR/main.js"
cp manifest.json "$PLUGIN_DIR/manifest.json" 2>/dev/null || true
cp src/styles.css "$PLUGIN_DIR/styles.css" 2>/dev/null || true
log "  OK"

log "[2/4] Ensure plugin ready..."
if ! wait_for_ping; then
  restart_obsidian
  wait_for_ping || fail "Obsidian CLI ping never recovered"
fi
obsidian "vault=$VAULT" plugin:reload "id=$PLUGIN" 2>&1 | grep -v FATAL > /dev/null || true
sleep 3
if ! wait_for_plugin_ready; then
  log "  plugin.ready missed the reload window; retrying once after restart..."
  restart_obsidian
  wait_for_ping || fail "Obsidian CLI ping never recovered after restart"
  wait_for_plugin_ready || fail "plugin.ready never became true"
fi
log "  plugin.ready: true"

log "[3/4] Capture provider runtime state..."
obsidian "vault=$VAULT" dev:errors clear 2>&1 | grep -v FATAL > /dev/null || true
obsidian "vault=$VAULT" dev:debug on 2>&1 | grep -v FATAL > /dev/null || true
RUNTIME_JSON=$(eval_cmd '(function(){var p=app.plugins.plugins["open-connections"]; return JSON.stringify({adapter:p?.embed_adapter?.adapter ?? null, model_key:p?.embed_adapter?.model_key ?? null, dims:p?.embed_adapter?.dims ?? null, embed_ready:!!p?.embed_ready, phase:p?._embed_state?.phase ?? null, last_error:p?._embed_state?.lastError ?? null});})()' || true)
DEV_ERRORS=$(sanitize_dev_output "$(obsidian "vault=$VAULT" dev:errors 2>&1 | grep -v FATAL || true)")
DEV_CONSOLE_ERRORS=$(sanitize_dev_output "$(obsidian "vault=$VAULT" dev:console level=error 2>&1 | grep -v FATAL || true)")

ACTUAL_ADAPTER=$(printf '%s' "$RUNTIME_JSON" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("adapter") or ""))' 2>/dev/null || true)
ACTUAL_MODEL_KEY=$(printf '%s' "$RUNTIME_JSON" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("model_key") or ""))' 2>/dev/null || true)
ACTUAL_DIMS=$(printf '%s' "$RUNTIME_JSON" | python3 -c 'import json,sys; v=json.load(sys.stdin).get("dims"); print("" if v is None else v)' 2>/dev/null || true)
EMBED_READY=$(printf '%s' "$RUNTIME_JSON" | python3 -c 'import json,sys; print(str(bool(json.load(sys.stdin).get("embed_ready"))).lower())' 2>/dev/null || true)
PHASE=$(printf '%s' "$RUNTIME_JSON" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("phase") or ""))' 2>/dev/null || true)
LAST_ERROR=$(printf '%s' "$RUNTIME_JSON" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("last_error") or ""))' 2>/dev/null || true)

log "  runtime: $RUNTIME_JSON"

PASS_COUNT=0
TOTAL_CHECKS=0

check_eq() {
  local name="$1"
  local actual="$2"
  local expected="$3"
  if [[ -z "$expected" ]]; then
    return 0
  fi
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "$actual" == "$expected" ]]; then
    log "  ✓ $name: $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log "  ✗ $name: got '$actual', expected '$expected'"
  fi
}

check_truthy() {
  local name="$1"
  local actual="$2"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ -n "$actual" && "$actual" != "null" ]]; then
    log "  ✓ $name: $actual"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log "  ✗ $name: value missing"
  fi
}

check_empty() {
  local name="$1"
  local actual="$2"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ -z "$actual" ]]; then
    log "  ✓ $name: none"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log "  ✗ $name: $(printf '%s' "$actual" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-200)"
  fi
}

check_truthy "Active adapter present" "$ACTUAL_ADAPTER"
check_truthy "Active model key present" "$ACTUAL_MODEL_KEY"
check_truthy "Active dims present" "$ACTUAL_DIMS"
check_eq "Expected adapter" "$ACTUAL_ADAPTER" "$EXPECTED_ADAPTER"
check_eq "Expected model key" "$ACTUAL_MODEL_KEY" "$EXPECTED_MODEL_KEY"
check_eq "Expected dims" "$ACTUAL_DIMS" "$EXPECTED_DIMS"
check_eq "Embed ready" "$EMBED_READY" "true"
check_empty "Last embed error" "$LAST_ERROR"
check_empty "Dev errors" "$DEV_ERRORS"
check_empty "Dev console errors" "$DEV_CONSOLE_ERRORS"

log "[4/4] Final report..."
log "  Active adapter: ${ACTUAL_ADAPTER:-unknown}"
log "  Active model: ${ACTUAL_MODEL_KEY:-unknown}"
log "  Active dims: ${ACTUAL_DIMS:-unknown}"
log "  Embed ready: ${EMBED_READY:-unknown}"
log "  Phase: ${PHASE:-unknown}"
log "  Checks: $PASS_COUNT/$TOTAL_CHECKS passed"
log "  Log: $LOGFILE"

if (( PASS_COUNT == TOTAL_CHECKS )); then
  log "RESULT: PASS"
  exit 0
fi

log "RESULT: FAIL"
exit 1
