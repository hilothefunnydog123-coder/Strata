#!/bin/sh
# Boot sequence for the deployed container.
#
# DESIGN RULE: serving is never blocked on the database.
#
# Two earlier versions of this script failed a deploy for the same underlying
# reason — they treated the database as a precondition for starting.
#
#   v1 made migrations fatal, so an unset or unreachable DATABASE_URL exited 1 and
#      the platform reported "exited with status 1 while running your code".
#   v2 made them non-fatal but still sequential, so an unreachable host burned the
#      whole retry budget before the server started and the health check timed out.
#
# So the web server starts FIRST and the database work runs alongside it. The
# marketing site is entirely static and needs no database at all; the console
# degrades on its own (a failed session lookup reads as signed out) and recovers by
# itself the moment migrations land. A data problem can no longer fail a deploy.

echo "[boot] Assent starting"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[boot] ------------------------------------------------------------" >&2
  echo "[boot] DATABASE_URL is not set." >&2
  echo "[boot] Marketing pages will serve; the console needs a database." >&2
  echo "[boot] Set DATABASE_URL in the service environment and redeploy." >&2
  echo "[boot] ------------------------------------------------------------" >&2
elif [ "${ASSENT_SKIP_BOOTSTRAP:-}" = "1" ]; then
  echo "[boot] ASSENT_SKIP_BOOTSTRAP=1 — skipping migrations and bootstrap"
else
  # Backgrounded on purpose: see the design rule above.
  (
    attempt=1
    max=5
    delay=3
    while [ "$attempt" -le "$max" ]; do
      echo "[db] applying migrations (attempt ${attempt}/${max})"
      if pnpm --filter @assent/db run migrate; then
        echo "[db] migrations applied"
        echo "[db] bootstrapping corpus (idempotent, offline)"
        # Provisions the founder account if it is absent and leaves it untouched if
        # it is not, so a redeploy can never reset the owner's own credentials.
        pnpm founder --bootstrap || echo "[db] WARNING: founder bootstrap skipped." >&2
        if pnpm db:seed && pnpm pipeline && pnpm blueprint --asset=asset_demo; then
          echo "[db] corpus ready — console is fully populated"
        else
          echo "[db] WARNING: bootstrap incomplete; console may show an empty corpus." >&2
        fi
        exit 0
      fi
      if [ "$attempt" -eq "$max" ]; then
        echo "[db] WARNING: migrations failed after ${max} attempts." >&2
        echo "[db] The site is serving, but the console stays unavailable until" >&2
        echo "[db] DATABASE_URL points at a reachable database. Redeploy to retry." >&2
      else
        echo "[db] database not ready, retrying in ${delay}s" >&2
        sleep "$delay"
        delay=$((delay * 2))
      fi
      attempt=$((attempt + 1))
    done
  ) &
fi

echo "[boot] starting web on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec pnpm --filter @assent/web start
