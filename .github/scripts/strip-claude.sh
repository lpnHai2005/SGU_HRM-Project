#!/usr/bin/env bash
# Removes "Co-Authored-By: Claude" trailers from main's history. Rewrite is deterministic,
# so a re-merged copy of the old history collapses back onto the already-clean commits.
set -euo pipefail
BASE=deec372 # last commit before the first Claude trailer

git log --format=%B "$BASE..HEAD" | grep -qi '^Co-Authored-By: Claude' || { echo "clean"; exit 0; }

old_tree=$(git rev-parse 'HEAD^{tree}')
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f \
  --msg-filter "sed '/^Co-Authored-By: Claude/Id' | sed -e :a -e '/^\n*\$/{\$d;N;ba' -e '}'" \
  --commit-filter '
    t=$1; shift
    ps=$(printf "%s\n" "$@" | grep -v "^-p$" | awk "!s[\$0]++")
    # a merge whose parents became identical with an unchanged tree is a leftover of the old history: drop it
    if [ $(git rev-list --parents -n1 "$GIT_COMMIT" | wc -w) -ge 3 ] && [ $(echo "$ps" | grep -c .) -eq 1 ] && [ "$(git rev-parse "$ps^{tree}")" = "$t" ]; then
      echo "$ps"
    else
      git commit-tree "$t" $(for p in $ps; do printf -- "-p %s " "$p"; done)
    fi' \
  -- "$BASE..HEAD"
rm -rf .git/refs/original

[ "$(git rev-parse 'HEAD^{tree}')" = "$old_tree" ] || { echo "tree changed, aborting"; exit 1; }
! git log --format=%B "$BASE..HEAD" | grep -qi '^Co-Authored-By: Claude'
echo "rewritten"
