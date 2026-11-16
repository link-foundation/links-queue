# Publishing links-queue

The npm package and Rust crate are both named `links-queue`. There are no
independently published JavaScript integration packages. Install `links-queue`
and import `links-queue/express`, `links-queue/fastify`, `links-queue/hono`, or
`links-queue/nestjs`. Install the corresponding framework separately; framework
peer dependencies are optional so core consumers do not install all frameworks.
The integrations and their TypeScript declarations ship inside the same tarball.

## Release workflows

- `.github/workflows/js.yml`: merging a changeset under `js/.changeset/` into
  main versions the package and publishes it after lint, tests, and an installed
  tarball smoke test pass. Manual instant releases also require these checks and
  run only on main. The release job grants `id-token: write`, runs npm 11 or
  later on Node 24, and invokes `npm publish --access public --provenance`.
  Publication succeeds only after the exact name/version is visible on npm.
- `.github/workflows/rust.yml`: merging a changelog fragment under
  `rust/changelog.d/` into main versions and publishes the crate after lint,
  tests, package verification, and builds. Both automatic and manual release
  jobs exchange the GitHub OIDC identity using the pinned
  `rust-lang/crates-io-auth-action`, then run `cargo publish` and verify registry
  visibility. The existing optional token fallback remains for compatibility
  with issue #53's policy; configured trusted publishing needs no repository
  token secret.

Neither workflow publishes from a pull request. A passing PR verifies packaging
and release logic; it does not establish that a live registry upload occurred.

## Initial registry setup

Registry account access is required to bootstrap a new package/crate and register
its trusted publisher. A GitHub repository credential alone cannot do this.
Do not add long-lived registry tokens to repository secrets.

For npm, publish the first package version from an authenticated maintainer
session if the package does not exist yet. Under the package's Settings →
Trusted publishing, register:

- Provider: GitHub Actions
- Owner: `link-foundation`
- Repository: `links-queue`
- Workflow filename: `js.yml`
- Environment: leave empty

Use the [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
for account setup. The split names must remain unpublished; do not run npm publish
from an integration directory.

For crates.io, the first version must exist before a trusted publisher can be
registered. An authenticated maintainer can bootstrap with
`package-registry-manager setup --repository . --registry crates-io --execute`,
which publishes with a short-lived credential and registers the publisher, or
publish once manually and register it under the crate's settings:

- Owner: `link-foundation`
- Repository: `links-queue`
- Workflow filename: `rust.yml`
- Environment: leave empty

See [crates.io trusted publishing](https://crates.io/docs/trusted-publishing).
Subsequent releases use OIDC without `NPM_TOKEN`, `CARGO_TOKEN`, or
`CARGO_REGISTRY_TOKEN` secrets. Run a release on main and confirm the publishing
step and registry visibility; an initial manual upload alone does not verify
workflow publication.

## Verification

```sh
cd js
npm run test:package
node --test scripts/publish-to-npm.test.mjs
npm view links-queue version
# Each of these must return E404:
npm view links-queue-js version
npm view links-queue-express version
npm view links-queue-fastify version
npm view links-queue-hono version
npm view links-queue-nestjs version
cd ../rust
node --test scripts/crates-io.test.mjs
cargo search links-queue --limit 5
```

The package test installs the packed artifact into a temporary consumer, checks
core without frameworks, then loads every integration with framework peers,
creates routers/plugins/services, and checks TypeScript subpath resolution.
Temporary files are removed even on failure. CI runs this test with a finite
job and test timeout.
