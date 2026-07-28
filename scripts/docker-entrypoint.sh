#!/bin/sh
# Boot sequence for the deployed container.
#
#   1. migrations      — fatal. Without the schema nothing else can work.
#   2. data bootstrap  — best effort. Seeds the demo account and runs the offline
#                        pipeline so a fresh deploy has a populated console. Fully
#                        idempotent and network-free, but if it fails the site must
#                        still come up rather than crash-loop.
#   3. serve
set -e

echo "[boot] applying migrations"
pnpm --filter @assent/db run migrate

if [ "${ASSENT_SKIP_BOOTSTRAP:-}" = "1" ]; then
  echo "[boot] ASSENT_SKIP_BOOTSTRAP=1 — skipping data bootstrap"
else
  echo "[boot] bootstrapping corpus (idempotent, offline)"
  if pnpm db:seed \
    && pnpm pipeline \
    && pnpm blueprint --asset=asset_demo; then
    echo "[boot] corpus ready"
  else
    echo "[boot] WARNING: data bootstrap did not complete; serving anyway." >&2
    echo "[boot] the console will show an empty corpus until it is re-run." >&2
  fi
fi

echo "[boot] starting web on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec pnpm --filter @assent/web start
