#!/usr/bin/env node

/**
 * crates.io helpers for the Rust CI/CD pipeline
 *
 * Usage:
 *   node scripts/crates-io.mjs status    # Is the Cargo.toml version on crates.io?
 *   node scripts/crates-io.mjs publish   # Publish it, then wait until crates.io serves it
 *
 * `status` writes `crate`, `version` and `published` (true, false or unknown)
 * to $GITHUB_OUTPUT.
 *
 * `publish` reads these environment variables:
 *   CARGO_REGISTRY_TOKEN - token from trusted publishing (OIDC) or the
 *                          CARGO_REGISTRY_TOKEN / CARGO_TOKEN secret fallback
 *   TRUSTED_PUBLISHING   - outcome of the crates-io-auth-action step
 *   GITHUB_REPOSITORY    - owner/repo, used in the setup instructions
 *   WORKFLOW_FILE        - workflow registered as trusted publisher (rust.yml)
 *   VERIFY_ATTEMPTS      - crates.io polls after publishing (default 30)
 *   VERIFY_INTERVAL_MS   - delay between polls (default 10000)
 *
 * Only Node.js built-ins are used, so the script runs without installing
 * anything and its helpers can be unit tested (scripts/crates-io.test.mjs).
 */

import { readFileSync, appendFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const USER_AGENT =
  'links-queue-release (https://github.com/link-foundation/links-queue)';

/**
 * Read the package name and version from Cargo.toml content
 * @param {string} cargoToml
 * @returns {{name: string, version: string}}
 */
export function parseCargoToml(cargoToml) {
  const pkg = cargoToml.split(/^\[(?!package\])/m)[0];
  const name = pkg.match(/^name\s*=\s*"([^"]+)"/m);
  const version = pkg.match(/^version\s*=\s*"([^"]+)"/m);
  if (!name || !version) {
    throw new Error('Could not parse [package] name and version');
  }
  return { name: name[1], version: version[1] };
}

/**
 * Describe the trusted publisher that crates.io must have registered
 * @param {{name: string, repository: string, workflow: string}} options
 * @returns {{settings: string, publisher: string}}
 */
export function trustedPublisher({ name, repository, workflow }) {
  const [owner, repo] = repository.split('/');
  return {
    settings: `https://crates.io/crates/${name}/settings`,
    publisher: `owner ${owner}, repository ${repo}, workflow ${workflow}, no environment`,
  };
}

/**
 * Classify a failed `cargo publish` output
 * @param {string} output
 * @returns {'already-published' | 'credentials' | 'other'}
 */
export function classifyPublishFailure(output) {
  if (/already (uploaded|exists)/i.test(output)) {
    return 'already-published';
  }
  if (
    /unauthorized|forbidden|\b40[13]\b|invalid token|token (expired|rejected)|no token found|please provide a non-empty token/i.test(
      output
    )
  ) {
    return 'credentials';
  }
  return 'other';
}

/**
 * Instructions shown when no crates.io credential is available
 * @param {{name: string, repository: string, workflow: string}} options
 * @returns {string[]}
 */
export function missingCredentialsHelp(options) {
  const { settings, publisher } = trustedPublisher(options);
  return [
    `::error title=crates.io credentials missing::Cannot publish ${options.name} to crates.io: trusted publishing is unavailable and neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set.`,
    '',
    'How to fix (trusted publishing is preferred; it needs no long-lived secret):',
    '  1. First release only: crates.io registers a trusted publisher only for an',
    '     existing crate, so publish the first version and register the publisher with',
    `       package-registry-manager setup --repository . --registry crates-io --execute`,
    '     or manually: publish once with a token, then as a crate owner open',
    `       ${settings} -> Trusted Publishing -> Add -> GitHub`,
    `     and enter: ${publisher}.`,
    '     Docs: https://crates.io/docs/trusted-publishing',
    '  2. Token fallback: create a token at https://crates.io/settings/tokens',
    `     (scopes 'publish-new' and 'publish-update') and add it at`,
    '     Settings -> Secrets and variables -> Actions -> New repository secret',
    '     named CARGO_REGISTRY_TOKEN (CARGO_TOKEN is also accepted).',
    '  3. Re-run the failed workflow run.',
  ];
}

/**
 * Instructions shown when crates.io rejects the credential
 * @param {{name: string, repository: string, workflow: string, trusted: boolean}} options
 * @returns {string[]}
 */
export function rejectedCredentialsHelp(options) {
  const { settings, publisher } = trustedPublisher(options);
  if (options.trusted) {
    return [
      '::error title=crates.io credentials rejected::crates.io rejected the trusted publishing (OIDC) token.',
      '',
      'How to fix:',
      `  1. Check the trusted publisher at ${settings} (Trusted Publishing).`,
      `     It must read: ${publisher}.`,
      '  2. Re-run the failed workflow run. Docs: https://crates.io/docs/trusted-publishing',
    ];
  }
  return [
    '::error title=crates.io credentials rejected::crates.io rejected the CARGO_REGISTRY_TOKEN / CARGO_TOKEN secret (trusted publishing was unavailable).',
    '',
    'How to fix (trusted publishing is preferred):',
    '  1. Register the trusted publisher so no token is needed: as a crate owner open',
    `     ${settings} -> Trusted Publishing -> Add -> GitHub`,
    `     and enter: ${publisher}.`,
    '  2. Or rotate the token, which may have expired or been revoked, at',
    '     https://crates.io/settings/tokens and update the CARGO_REGISTRY_TOKEN secret.',
    '  3. Re-run the failed workflow run.',
  ];
}

/**
 * Ask crates.io whether a crate version exists
 * @param {string} name
 * @param {string} version
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<'true' | 'false' | 'unknown'>}
 */
export async function isPublished(name, version, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(
      `https://crates.io/api/v1/crates/${name}/${version}`,
      { headers: { 'User-Agent': USER_AGENT } }
    );
    if (response.status === 200) {
      return 'true';
    }
    if (response.status === 404) {
      return 'false';
    }
    console.log(`crates.io answered HTTP ${response.status}`);
  } catch (error) {
    console.log(`crates.io request failed: ${error.message}`);
  }
  return 'unknown';
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`${key}=${value}`);
}

async function status(crate) {
  setOutput('crate', crate.name);
  setOutput('version', crate.version);
  setOutput('published', await isPublished(crate.name, crate.version));
}

async function verify(crate) {
  const attempts = Number(process.env.VERIFY_ATTEMPTS || 30);
  const interval = Number(process.env.VERIFY_INTERVAL_MS || 10000);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if ((await isPublished(crate.name, crate.version)) === 'true') {
      console.log(
        `Verified: https://crates.io/crates/${crate.name}/${crate.version}`
      );
      return true;
    }
    console.log(
      `Waiting for crates.io to serve ${crate.name} ${crate.version} (${attempt}/${attempts})`
    );
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  console.log(
    `::error title=crates.io verification failed::${crate.name} ${crate.version} is not visible on crates.io after publishing.`
  );
  return false;
}

async function publish(crate) {
  const options = {
    name: crate.name,
    repository: process.env.GITHUB_REPOSITORY || 'link-foundation/links-queue',
    workflow: process.env.WORKFLOW_FILE || 'rust.yml',
  };
  const trusted = process.env.TRUSTED_PUBLISHING === 'success';

  if ((await isPublished(crate.name, crate.version)) === 'true') {
    console.log(
      `${crate.name} ${crate.version} is already on crates.io, skipping cargo publish`
    );
    return verify(crate);
  }

  if (trusted) {
    console.log('Publishing with a crates.io trusted publishing (OIDC) token.');
  } else {
    const { settings, publisher } = trustedPublisher(options);
    console.log(
      `::warning title=crates.io trusted publishing unavailable::OIDC token exchange outcome: ${process.env.TRUSTED_PUBLISHING || 'skipped'}. Falling back to the CARGO_REGISTRY_TOKEN / CARGO_TOKEN secret. To publish without a long-lived token, register the trusted publisher at ${settings} (Trusted Publishing -> Add -> GitHub: ${publisher}).`
    );
  }

  if (!process.env.CARGO_REGISTRY_TOKEN) {
    console.log(missingCredentialsHelp(options).join('\n'));
    return false;
  }

  const result = spawnSync('cargo', ['publish'], { encoding: 'utf-8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  console.log(output);
  if (result.status === 0) {
    return verify(crate);
  }

  switch (classifyPublishFailure(output)) {
    case 'already-published':
      console.log(
        '::warning::Version was published by another run; treating as success.'
      );
      return verify(crate);
    case 'credentials':
      console.log(rejectedCredentialsHelp({ ...options, trusted }).join('\n'));
      return false;
    default:
      console.log(
        `::error title=cargo publish failed::cargo publish exited with ${result.status ?? result.error?.message}`
      );
      return false;
  }
}

async function main() {
  const command = process.argv[2];
  const crate = parseCargoToml(readFileSync('Cargo.toml', 'utf-8'));

  if (command === 'status') {
    await status(crate);
  } else if (command === 'publish') {
    if (!(await publish(crate))) {
      process.exit(1);
    }
  } else {
    console.error('Usage: node scripts/crates-io.mjs <status|publish>');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
