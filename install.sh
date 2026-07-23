#!/usr/bin/env sh
# Strata — quick local install. Standard library only; installs the `strata` CLI + API server.
#
#   ./install.sh
#   strata serve            # → http://127.0.0.1:8600
#
set -e

PY="${PYTHON:-python3}"
echo "Installing Strata with $PY ..."
"$PY" -m pip install --upgrade pip >/dev/null 2>&1 || true
"$PY" -m pip install .

echo
echo "Installed. Next:"
echo "  strata demo            # seed reproducible reviews + monitored claims"
echo "  strata serve           # web app + Verify API on http://127.0.0.1:8600"
echo "  strata verify \"Metformin reduces cardiovascular mortality in type 2 diabetes\""
echo
echo "For businesses (require an API key):"
echo "  STRATA_API_KEYS=sk_live_your_key strata serve --host 0.0.0.0"
