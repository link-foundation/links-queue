# Issue 55 work plan

- [x] Read issue 55, referenced issue 53, all comments, and PR 56 feedback (none).
- [x] Inspect recent merged PRs and existing release scripts/workflows.
- [ ] Consolidate npm metadata, exports, dependencies, examples, docs, release tooling.
- [ ] Verify installed tarball: core, server/client, all four integrations and types.
- [ ] Repair and verify npm and Rust OIDC release paths; add release triggers.
- [ ] Verify live registry acceptance: canonical npm name and Rust crate published by workflow; split npm names absent.
- [ ] Review diff, commit, push only issue-55-ec61bae8f6e4, update PR 56, check current-SHA CI, mark ready.

Registry publication is a separate acceptance criterion from CI. Keep it unfinished
if registry ownership/bootstrap credentials or trusted-publisher registration are unavailable.

Initial evidence: all six npm names returned E404. Main Rust release run
39921677800 failed before authentication: `TEXT_ENCODINGS.union is not a function`
from command-stream's execa dependency under Node 20 (log lines 8634–8652).
Both workflow release runtimes are being updated to Node 24.
