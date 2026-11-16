# Issue 55 work plan

- [x] Read issue 55, referenced issue 53, all comments, and PR 56 feedback (none).
- [x] Inspect recent merged PRs and existing release scripts/workflows.
- [x] Consolidate npm metadata, exports, dependencies, examples, docs, release tooling.
- [x] Verify installed tarball: core, server/client, all four integrations and types.
- [x] Repair npm and Rust OIDC release paths; add release triggers and startup verification.
- [ ] Verify live registry acceptance: canonical npm name and Rust crate published by workflow; split npm names absent.
- [x] Review diff, commit, push only issue-55-ec61bae8f6e4, update PR 56.
Final-SHA CI and ready status are tracked on PR #56.

Registry publication is a separate acceptance criterion from CI. Keep it unfinished
if registry ownership/bootstrap credentials or trusted-publisher registration are unavailable.

Initial evidence: all six npm names returned E404. Main Rust release run
39921677800 failed before authentication: `TEXT_ENCODINGS.union is not a function`
from command-stream's execa dependency under Node 20 (log lines 8634–8652).
Both workflow release runtimes are being updated to Node 24.

Verification: installed tarball test passed locally and on CI; pre-change main
fails the same test (`experiments/issue-55-package-regression.sh`). npm publisher
unit tests and all 11 Rust release helper tests pass. JS lint, formatting,
duplication checks, and changeset status pass. CI verifies release script startup
on Node 24 to regress the main-branch failure without creating commits or tags.

Live publication remains blocked: npm whoami reports ENEEDAUTH; no Cargo
credentials file or repository Actions secrets exist. All npm names still return
E404; cargo search returns no matching crate (direct crates.io API access is
HTTP 403 in this environment). A registry owner must bootstrap and register the
trusted publishers; this is documented in the PR and release guide. The PR is
kept unmerged and live publication is not claimed as complete.

CI investigation: the initial Bun/Windows job also discovered Node-only release
script tests. Its package test failed because shell invocation split inline
JavaScript (`Unexpected end of file`, job log lines 183–225). The package test
now uses a real module file and invokes executables without a shell. Bun CI is
scoped to its existing runtime suite in tests/; packaging remains explicitly
covered by the Node 24 Verify npm Package job.
