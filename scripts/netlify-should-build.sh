#!/usr/bin/env sh
#
# Decide whether a Netlify build is worth spending build minutes on.
#
# Netlify's contract is inverted from what you would guess: exit 0 means CANCEL
# the build, and a non-zero exit means PROCEED. Getting that backwards means
# either never building or always building, so it is worth stating plainly.
#
# The rule: if a push changed nothing except documentation, do not rebuild. The
# deployed site is identical either way, so the build would produce the same
# artifact at the cost of build minutes.
#
# Two cases deliberately build anyway:
#
#   - No cached commit. That is a first build, a cleared cache, or a context
#     Netlify has not built before. There is nothing to compare against, so
#     building is the only safe answer.
#   - Anything git cannot answer. If the diff command itself fails, this exits
#     non-zero and the build proceeds. A cost control that can silently stop
#     deploys is worse than the cost it saves.

set -u

# Netlify sets both. CACHED_COMMIT_REF is the commit of the last successful
# build in this context; COMMIT_REF is the one being considered.
if [ -z "${CACHED_COMMIT_REF:-}" ] || [ -z "${COMMIT_REF:-}" ]; then
  echo "No cached commit to compare against. Building."
  exit 1
fi

# Paths that cannot change what is served. Everything else counts as a change
# worth building, including package.json, lockfiles, and configuration.
if git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- \
  . \
  ':(exclude)*.md' \
  ':(exclude)docs/**' \
  ':(exclude).github/**'; then
  echo "Only documentation changed between $CACHED_COMMIT_REF and $COMMIT_REF. Skipping build."
  exit 0
fi

echo "Source changed between $CACHED_COMMIT_REF and $COMMIT_REF. Building."
exit 1
