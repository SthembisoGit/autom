#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:4010}"
PROFILE_ID="${PROFILE_ID:-profile_default}"
TOPIC="${1:-daily stoic lesson}"

PAYLOAD=$(printf '{"profileId":"%s","topic":"%s"}' "$PROFILE_ID" "$TOPIC")

curl --fail --silent --show-error \
  --request POST \
  --header "Content-Type: application/json" \
  --data "$PAYLOAD" \
  "$API_URL/jobs/generate"
