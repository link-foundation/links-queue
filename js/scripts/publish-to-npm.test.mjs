import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishPackage, registryVersion } from './publish-to-npm.mjs';

const manifest = { name: 'links-queue', version: '0.16.0' };

test('publishes only the canonical package and verifies registry visibility', async () => {
  const calls = [];
  let checks = 0;
  await publishPackage({
    manifest,
    lookup: async (name, version) => {
      assert.equal(name, manifest.name);
      assert.equal(version, manifest.version);
      return ++checks === 3;
    },
    run: (...args) => calls.push(args),
    wait: async () => {},
  });
  assert.deepEqual(calls, [
    ['npm', ['publish', '--access', 'public', '--provenance']],
  ]);
});

test('reruns skip existing versions', async () => {
  await publishPackage({
    manifest,
    lookup: async () => true,
    run: () => assert.fail('must not republish'),
  });
});

test('failed or invisible publishes cannot report success', async () => {
  await assert.rejects(
    publishPackage({
      manifest,
      lookup: async () => false,
      run: () => {
        throw new Error('OIDC rejected');
      },
      wait: async () => {},
    }),
    /OIDC rejected/
  );
  await assert.rejects(
    publishPackage({
      manifest,
      lookup: async () => false,
      run: () => {},
      wait: async () => {},
    }),
    /missing from npm/
  );
});

test('split names cannot be published by this helper', async () => {
  await assert.rejects(
    publishPackage({
      manifest: { name: 'links-queue-express', version: '1.0.0' },
    }),
    /Only the consolidated/
  );
});

test('registry failures are distinguished from absent versions', async () => {
  assert.equal(
    await registryVersion('links-queue', '1', async () => ({ status: 404 })),
    false
  );
  await assert.rejects(
    registryVersion('links-queue', '1', async () => ({ status: 503 })),
    /HTTP 503/
  );
});

test('retries transient publish failures without uploading existing versions twice', async () => {
  let uploads = 0;
  let visible = false;
  await publishPackage({
    manifest,
    lookup: async () => visible,
    run: () => {
      if (++uploads === 1) {
        throw new Error('connection reset');
      }
      visible = true;
    },
    wait: async () => {},
  });
  assert.equal(uploads, 2);
  uploads = 0;
  visible = false;
  const result = await publishPackage({
    manifest,
    lookup: async () => visible,
    run: () => {
      uploads++;
      visible = true;
      throw new Error('connection lost after upload');
    },
    wait: async () => {},
  });
  assert.equal(uploads, 1);
  assert.equal(result.alreadyPublished, true);
});
