#!/usr/bin/env node

/** Publish the single npm package with GitHub Actions OIDC, then verify it. */
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function registryVersion(name, version, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://registry.npmjs.org/${name}/${version}`
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.name === name && data.version === version;
}

export async function publishPackage({
  manifest,
  run = (command, args) => execFileSync(command, args, { stdio: 'inherit' }),
  lookup = registryVersion,
  wait = () => new Promise((resolve) => setTimeout(resolve, 10000)),
}) {
  if (manifest.name !== 'links-queue') {
    throw new Error(
      'Only the consolidated links-queue package may be published'
    );
  }
  const { name, version } = manifest;
  if (await lookup(name, version)) {
    console.log(`${name}@${version} is already published`);
    return { alreadyPublished: true };
  }
  // npm >= 11.5.1 discovers the Actions OIDC credentials automatically.
  // Publish only the current package, never traverse integration directories.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await run('npm', ['publish', '--access', 'public', '--provenance']);
      break;
    } catch (error) {
      // A registry may accept an upload before the client loses its connection.
      if (await lookup(name, version)) {
        return { alreadyPublished: true };
      }
      if (attempt === 2) {
        throw error;
      }
      console.log(`Publish attempt ${attempt + 1} failed: ${error.message}`);
      await wait();
    }
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await lookup(name, version)) {
      console.log(`Verified ${name}@${version} on npm`);
      return { alreadyPublished: false };
    }
    if (attempt < 11) {
      await wait();
    }
  }
  throw new Error(`${name}@${version} is missing from npm after publication`);
}

async function main() {
  if (
    process.argv.includes('--should-pull') ||
    process.env.SHOULD_PULL === 'true'
  ) {
    execFileSync('git', ['pull', '--ff-only', 'origin', 'main'], {
      stdio: 'inherit',
    });
  }
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const result = await publishPackage({ manifest });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `published=true\npublished_version=${manifest.version}\nalready_published=${result.alreadyPublished}\n`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    console.error(
      'Register link-foundation/links-queue and workflow js.yml as the npm trusted publisher. See docs/guides/releasing.md for first-publication setup.'
    );
    process.exitCode = 1;
  });
}
