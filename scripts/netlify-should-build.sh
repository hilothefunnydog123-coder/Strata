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

# The same commit on both sides is not "nothing changed", it is "nothing to
# compare". Netlify sets these equal when it has no successful build of a
# different commit to measure against, and on a manual retry of the same commit.
# Diffing a commit against itself finds no changes, so an earlier version of
# this script read that as a documentation-only push and skipped, which meant a
# first deploy never ran and a retry could never work.
if [ "$CACHED_COMMIT_REF" = "$COMMIT_REF" ]; then
  echo "Cached and current commit are the same ($COMMIT_REF). Nothing to compare. Building."
  exit 1
fi

# A commit the clone does not contain cannot be diffed. Netlify clones with
# --filter=blob:none and does not always have the cached commit's history, in
# which case git would fail and this would be deciding on an error.
if ! git cat-file -e "${CACHED_COMMIT_REF}^{commit}" 2>/dev/null; then
  echo "Cached commit $CACHED_COMMIT_REF is not in this clone. Building."
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
