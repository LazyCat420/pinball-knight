# Shared helpers for the pinball-knight hooks. Source, don't execute.
#
# Deliberately python3 and not jq: jq is NOT installed on this box, and a hook
# whose JSON parser is missing fails open — it would exit nonzero on every edit
# and read as "the hook is noisy" rather than "the hook never ran". /usr/bin/
# python3 is a fixed system path with no version manager in front of it.
#
# node IS relied on (registry-drift.mjs, npx tsc/vitest) but comes from nvm, so
# it is resolved with a fallback rather than assumed to be on PATH.

PY=/usr/bin/python3

# hk_field <json> <key> [<subkey>] — prints the value, or empty.
hk_field() {
  HK_JSON="$1" HK_K1="${2:-}" HK_K2="${3:-}" "$PY" - <<'EOF'
import json, os, sys
try:
    d = json.loads(os.environ["HK_JSON"])
except Exception:
    sys.exit(0)
k1, k2 = os.environ["HK_K1"], os.environ["HK_K2"]
v = d.get(k1)
if k2:
    v = (v or {}).get(k2)
sys.stdout.write("" if v is None else str(v))
EOF
}

# hk_json <<'PYARGS' — emit a JSON object from KEY=VALUE-ish env. Callers use
# the two wrappers below instead.
hk_emit_system_message() {
  HK_MSG="$1" "$PY" -c 'import json,os;print(json.dumps({"systemMessage":os.environ["HK_MSG"]}))'
}

hk_emit_additional_context() {
  HK_EVENT="$1" HK_CTX="$2" "$PY" -c 'import json,os;print(json.dumps({"hookSpecificOutput":{"hookEventName":os.environ["HK_EVENT"],"additionalContext":os.environ["HK_CTX"]}}))'
}

hk_emit_deny() {
  HK_REASON="$1" "$PY" -c 'import json,os;print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":os.environ["HK_REASON"]}}))'
}

# Resolve node even if nvm is not on this shell's PATH.
hk_node() {
  if command -v node >/dev/null 2>&1; then echo node; return; fi
  local n
  n="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)"
  [ -n "$n" ] && echo "$n"
}
