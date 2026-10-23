/**
 * Unit tests for scripts/crates-io.mjs
 *
 * Run: node --test scripts/crates-io.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

import {
  parseCargoToml,
  trustedPublisher,
  classifyPublishFailure,
  missingCredentialsHelp,
  rejectedCredentialsHelp,
  isPublished,
} from './crates-io.mjs';

const options = {
  name: 'links-queue',
  repository: 'link-foundation/links-queue',
  workflow: 'rust.yml',
};

test('parseCargoToml reads the package, not the [lib] name', () => {
  const crate = parseCargoToml(
    '[package]\nname = "links-queue"\nversion = "1.2.3"\n\n[lib]\nname = "links_queue"\n'
  );
  assert.deepEqual(crate, { name: 'links-queue', version: '1.2.3' });
});

test('parseCargoToml reads the real Cargo.toml', () => {
  const crate = parseCargoToml(
    readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf-8')
  );
  assert.equal(crate.name, 'links-queue');
  assert.match(crate.version, /^\d+\.\d+\.\d+$/);
});

test('parseCargoToml rejects a manifest without a package', () => {
  assert.throws(() => parseCargoToml('[workspace]\nmembers = []\n'));
});

test('Cargo.toml stays publishable', () => {
  const cargoToml = readFileSync(
    new URL('../Cargo.toml', import.meta.url),
    'utf-8'
  );
  assert.doesNotMatch(cargoToml, /^publish\s*=\s*false/m);
});

test('trustedPublisher matches the crates.io trusted publisher form', () => {
  assert.deepEqual(trustedPublisher(options), {
    settings: 'https://crates.io/crates/links-queue/settings',
    publisher:
      'owner link-foundation, repository links-queue, workflow rust.yml, no environment',
  });
});

test('classifyPublishFailure recognizes already published versions', () => {
  assert.equal(
    classifyPublishFailure('error: crate version `0.3.1` is already uploaded'),
    'already-published'
  );
  assert.equal(
    classifyPublishFailure(
      'crate links-queue@0.3.1 already exists on crates.io index'
    ),
    'already-published'
  );
});

test('classifyPublishFailure recognizes rejected credentials', () => {
  for (const output of [
    'the remote server responded with an error (status 403 Forbidden)',
    'status 401 Unauthorized: this token is invalid',
    'error: no token found, please run `cargo login`',
  ]) {
    assert.equal(classifyPublishFailure(output), 'credentials', output);
  }
});

test('classifyPublishFailure leaves other failures alone', () => {
  assert.equal(
    classifyPublishFailure('error[E0425]: cannot find value `x` in this scope'),
    'other'
  );
});

test('missing credentials help explains both fixes', () => {
  const help = missingCredentialsHelp(options).join('\n');
  assert.match(help, /^::error title=crates.io credentials missing::/);
  assert.match(help, /package-registry-manager setup/);
  assert.match(help, /https:\/\/crates.io\/crates\/links-queue\/settings/);
  assert.match(help, /workflow rust.yml, no environment/);
  assert.match(help, /CARGO_REGISTRY_TOKEN/);
  assert.match(help, /CARGO_TOKEN/);
});

test('rejected credentials help depends on the credential used', () => {
  assert.match(
    rejectedCredentialsHelp({ ...options, trusted: true }).join('\n'),
    /trusted publishing \(OIDC\) token/
  );
  assert.match(
    rejectedCredentialsHelp({ ...options, trusted: false }).join('\n'),
    /rotate the token/
  );
});

test('isPublished maps crates.io answers', async () => {
  const answer = (status) => async (url, init) => {
    assert.equal(url, 'https://crates.io/api/v1/crates/links-queue/0.3.1');
    assert.match(init.headers['User-Agent'], /links-queue/);
    return { status };
  };
  assert.equal(await isPublished('links-queue', '0.3.1', answer(200)), 'true');
  assert.equal(await isPublished('links-queue', '0.3.1', answer(404)), 'false');
  assert.equal(
    await isPublished('links-queue', '0.3.1', answer(503)),
    'unknown'
  );
  assert.equal(
    await isPublished('links-queue', '0.3.1', async () => {
      throw new Error('offline');
    }),
    'unknown'
  );
});
