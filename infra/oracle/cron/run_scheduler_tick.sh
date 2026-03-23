#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/srv/autom}"

cd "$APP_ROOT"
npm --workspace @autom/server run scheduler:tick
