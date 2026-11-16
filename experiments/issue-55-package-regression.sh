#!/usr/bin/env bash
# Run the installed-tarball test against pre-consolidation main, expecting failure.
set -eu
repo_root=$(git rev-parse --show-toplevel)
probe_dir=$(mktemp -d)
trap 'rm -rf "$probe_dir"' EXIT
git -C "$repo_root" archive 26126546433d344879cb190818bf9d0091d8b6dc js | tar -x -C "$probe_dir"
cp "$repo_root/js/scripts/package.test.mjs" "$probe_dir/js/scripts/package.test.mjs"
cd "$probe_dir/js"
if node --test scripts/package.test.mjs; then
  echo 'ERROR: the pre-fix package unexpectedly passed the regression test' >&2
  exit 1
fi
echo 'Confirmed: the pre-fix package fails the installed-tarball regression test.'
