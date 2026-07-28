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
    # Patient on purpose. A managed Postgres that is cold, waking, or still being
    # attached can take minutes to answer, and giving up early leaves the console
    # with no account until someone thinks to redeploy. The server is already
    # serving throughout, so waiting here costs nothing.
    attempt=1
    max=12
    delay=3
    max_delay=30
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
          # The build sandbox cannot reach CMS; this container can. Try for the real
          # corpus rather than settling for sample text nobody can act on. It fetches
          # BEFORE it clears anything, does nothing when the corpus is already real,
          # and records what happened for /api/diagnostics — so the worst case is the
          # sample corpus we already had, clearly labelled as such.
          if [ "${ASSENT_CORPUS_AUTOFETCH:-1}" = "1" ]; then
            echo "[corpus] attempting the real CMS corpus"
            pnpm corpus:live --if-needed --limit="${ASSENT_CORPUS_LIMIT:-40}" \
              || echo "[corpus] live fetch did not succeed — keeping the sample corpus" >&2
          fi
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
        [ "$delay" -gt "$max_delay" ] && delay="$max_delay"
      fi
      attempt=$((attempt + 1))
    done
  ) &
fi

echo "[boot] starting web on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec pnpm --filter @assent/web start
