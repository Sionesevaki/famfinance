#!/usr/bin/env bash
set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }
}

require curl
require python3

BASE_URL="${BASE_URL:-http://localhost:4000}"
OWNER_TOKEN="${OWNER_TOKEN:-}"
INVITEE_TOKEN="${INVITEE_TOKEN:-}"
INVITE_TOKEN="${INVITE_TOKEN:-}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

json_get() {
  local key="$1"
  python3 - "$key" <<'PY'
import json, sys
key = sys.argv[1]
data = json.load(sys.stdin)
cur = data
for part in key.split("."):
  if cur is None:
    break
  if isinstance(cur, list) and part.isdigit():
    cur = cur[int(part)]
  elif isinstance(cur, dict):
    cur = cur.get(part)
  else:
    cur = None
print("" if cur is None else cur)
PY
}

api() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"

  local headers="$TMP_DIR/headers.txt"
  local resp="$TMP_DIR/resp.json"
  : >"$headers"
  : >"$resp"

  local args=(-sS -X "$method" "$BASE_URL$path" -D "$headers" -o "$resp")
  args+=(-H "Accept: application/json")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" --data "$body")
  fi

  local status
  status="$(curl "${args[@]}" -w "%{http_code}")"
  echo "$status"
}

expect_status() {
  local expected="$1"
  local got="$2"
  if [[ "$got" != "$expected" ]]; then
    echo "Expected HTTP $expected but got $got" >&2
    echo "--- response headers ---" >&2
    sed -n '1,200p' "$TMP_DIR/headers.txt" >&2 || true
    echo "--- response body ---" >&2
    sed -n '1,200p' "$TMP_DIR/resp.json" >&2 || true
    exit 1
  fi
}

echo "[1/6] /health"
status="$(api GET "/health")"
expect_status "200" "$status"
health_request_id="$(python3 - <<'PY'
import sys
hdr = open(sys.argv[1], "r", encoding="utf-8", errors="ignore").read().lower().splitlines()
for line in hdr:
  if line.startswith("x-request-id:"):
    print(line.split(":",1)[1].strip())
    sys.exit(0)
print("")
PY
"$TMP_DIR/headers.txt")"
if [[ -z "$health_request_id" ]]; then
  echo "Missing x-request-id header on /health response" >&2
  exit 1
fi

if [[ -z "$OWNER_TOKEN" ]]; then
  echo "OWNER_TOKEN not provided; stopping after /health." >&2
  exit 0
fi

echo "[2/6] /me (owner)"
status="$(api GET "/me" "$OWNER_TOKEN")"
expect_status "200" "$status"
owner_email="$(json_get "email" <"$TMP_DIR/resp.json")"
if [[ -z "$owner_email" ]]; then
  echo "Expected /me to return email" >&2
  exit 1
fi

echo "[3/6] POST /workspaces"
status="$(api POST "/workspaces" "$OWNER_TOKEN" '{"name":"Smoke Test Workspace","currency":"EUR"}')"
expect_status "201" "$status"
workspace_id="$(json_get "workspaceId" <"$TMP_DIR/resp.json")"
if [[ -z "$workspace_id" ]]; then
  echo "Expected workspaceId in response" >&2
  exit 1
fi

if [[ -n "$INVITEE_TOKEN" ]]; then
  echo "[4/6] Invite flow (optional)"

  invitee_email="$(python3 - <<'PY'
import base64, json, os, sys
t = os.environ.get("INVITEE_TOKEN", "")
if not t or "." not in t:
  print("")
  sys.exit(0)
payload = t.split(".")[1]
payload += "=" * ((4 - len(payload) % 4) % 4)
try:
  decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
  j = json.loads(decoded.decode("utf-8"))
  print(j.get("email") or "")
except Exception:
  print("")
PY
)"
  if [[ -z "$invitee_email" ]]; then
    echo "Could not extract invitee email from INVITEE_TOKEN; set INVITE_TOKEN manually if needed." >&2
  else
    status="$(api POST "/workspaces/$workspace_id/invites" "$OWNER_TOKEN" "{\"email\":\"$invitee_email\",\"role\":\"MEMBER\"}")"
    expect_status "201" "$status"
    token_from_api="$(json_get "tokenForTestOnly" <"$TMP_DIR/resp.json")"
    if [[ -z "$INVITE_TOKEN" && -n "$token_from_api" ]]; then
      INVITE_TOKEN="$token_from_api"
    fi

    if [[ -n "$INVITE_TOKEN" ]]; then
      status="$(api POST "/invites/accept" "$INVITEE_TOKEN" "{\"token\":\"$INVITE_TOKEN\"}")"
      expect_status "200" "$status"
    else
      echo "Invite created but no INVITE_TOKEN available (prod/staging emails it). Skipping accept step." >&2
    fi
  fi
else
  echo "[4/6] Invite flow skipped (no INVITEE_TOKEN)."
fi

echo "[5/6] Upload document + run pipeline (requires worker + S3/Redis configured)"
occurred_at="2025-12-17"
amount="12.34"
merchant="Amazon"
payload="$merchant
TOTAL EUR $amount
$occurred_at
"
doc_file="$TMP_DIR/smoke.txt"
printf "%s" "$payload" >"$doc_file"
size_bytes="$(python3 - <<PY
import os, sys
print(os.path.getsize(sys.argv[1]))
PY
"$doc_file")"

status="$(api POST "/workspaces/$workspace_id/documents/upload-url" "$OWNER_TOKEN" "{\"filename\":\"smoke.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":$size_bytes,\"type\":\"RECEIPT\"}")"
expect_status "201" "$status"
document_id="$(json_get "documentId" <"$TMP_DIR/resp.json")"
upload_url="$(json_get "uploadUrl" <"$TMP_DIR/resp.json")"
if [[ -z "$document_id" || -z "$upload_url" ]]; then
  echo "Missing documentId or uploadUrl in response" >&2
  exit 1
fi

curl -sS -X PUT -H "Content-Type: text/plain" --upload-file "$doc_file" "$upload_url" >/dev/null

status="$(api POST "/workspaces/$workspace_id/documents/$document_id/complete" "$OWNER_TOKEN")"
expect_status "200" "$status"

deadline="$(( $(date +%s) + 120 ))"
while true; do
  status="$(api GET "/workspaces/$workspace_id/documents/$document_id" "$OWNER_TOKEN")"
  expect_status "200" "$status"
  extraction_status="$(json_get "extraction.status" <"$TMP_DIR/resp.json")"
  if [[ "$extraction_status" == "SUCCEEDED" ]]; then
    break
  fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "Timed out waiting for extraction to succeed (status=$extraction_status)" >&2
    exit 1
  fi
  sleep 2
done

deadline="$(( $(date +%s) + 120 ))"
while true; do
  status="$(api GET "/workspaces/$workspace_id/transactions?limit=10" "$OWNER_TOKEN")"
  expect_status "200" "$status"
  count="$(python3 - <<'PY'
import json, sys
arr = json.load(sys.stdin)
print(len(arr) if isinstance(arr, list) else 0)
PY
<"$TMP_DIR/resp.json")"
  if [[ "$count" -ge 1 ]]; then
    break
  fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "Timed out waiting for transaction upsert" >&2
    exit 1
  fi
  sleep 2
done

echo "[6/6] Analytics summary"
status="$(api GET "/workspaces/$workspace_id/analytics/summary?month=2025-12" "$OWNER_TOKEN")"
expect_status "200" "$status"
total_cents="$(json_get "totalCents" <"$TMP_DIR/resp.json")"
if [[ "$total_cents" != "1234" ]]; then
  echo "Expected totalCents=1234 but got $total_cents" >&2
  exit 1
fi

echo "OK"

