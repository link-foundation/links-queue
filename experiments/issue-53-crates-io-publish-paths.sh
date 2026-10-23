#!/usr/bin/env bash
# Issue #53: exercise rust/scripts/crates-io.mjs without publishing anything.
#   1. status of the real crate (not on crates.io before the first release)
#   2. publish without credentials -> explicit "credentials missing" error, exit 1
#   3. publish of a version that already exists (serde 1.0.0) -> skipped, verified
set -u
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/rust/scripts/crates-io.mjs"

(cd "$(dirname "$SCRIPT")/.." && node "$SCRIPT" status)

(cd "$(dirname "$SCRIPT")/.." && env -u CARGO_REGISTRY_TOKEN TRUSTED_PUBLISHING=failure node "$SCRIPT" publish)
echo "publish without credentials exit=$?"

TMP=$(mktemp -d)
printf '[package]\nname = "serde"\nversion = "1.0.0"\n' > "$TMP/Cargo.toml"
(cd "$TMP" && VERIFY_ATTEMPTS=1 node "$SCRIPT" publish)
echo "publish of existing version exit=$?"
rm -rf "$TMP"
