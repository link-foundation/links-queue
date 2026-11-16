/** Test the shipped tarball from outside the source tree. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: command === 'npm.cmd',
  });
}

test(
  'installed package preserves core and integration entry points',
  { timeout: 180000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'links-queue-package-'));
    try {
      const [pack] = JSON.parse(
        run(
          npm,
          ['pack', '--ignore-scripts', '--json', '--pack-destination', dir],
          root
        )
      );
      const files = pack.files.map((file) => file.path);
      for (const framework of ['express', 'fastify', 'hono', 'nestjs']) {
        assert.ok(files.includes(`packages/${framework}/src/index.js`));
        assert.ok(files.includes(`packages/${framework}/src/index.d.ts`));
        assert.ok(!files.includes(`packages/${framework}/package.json`));
      }
      assert.ok(files.includes('LICENSE'));
      assert.ok(
        !files.some((file) => /^(tests|scripts|experiments)\//.test(file))
      );
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
      );
      run(
        npm,
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          join(dir, pack.filename),
        ],
        dir
      );
      // Core must load without any optional framework installed.
      writeFileSync(
        join(dir, 'core.mjs'),
        "import 'links-queue'; import 'links-queue/server'; import 'links-queue/client';"
      );
      run(process.execPath, ['core.mjs'], dir);
      run(
        npm,
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          'express@4',
          'fastify@5',
          'hono@4',
          '@nestjs/common@10',
          '@nestjs/core@10',
          'reflect-metadata',
          'rxjs',
          'typescript',
          '@types/express@4',
        ],
        dir
      );
      const manifest = JSON.parse(
        readFileSync(join(dir, 'node_modules/links-queue/package.json'), 'utf8')
      );
      assert.equal(manifest.name, 'links-queue');
      for (const name of Object.keys(manifest.peerDependencies)) {
        assert.equal(manifest.peerDependenciesMeta[name].optional, true);
      }
      writeFileSync(
        join(dir, 'smoke.mjs'),
        `
      import assert from 'node:assert/strict';
      import { MemoryQueueManager } from 'links-queue';
      import { linksQueueMiddleware, createQueueRouter } from 'links-queue/express';
      import plugin from 'links-queue/fastify';
      import { linksQueue, createQueueApp } from 'links-queue/hono';
      import { LinksQueueModule, LinksQueueService } from 'links-queue/nestjs';
      import Fastify from 'fastify';
      assert.equal(typeof linksQueueMiddleware(), 'function');
      assert.equal(typeof createQueueRouter(), 'function');
      assert.equal(typeof linksQueue(), 'function');
      assert.ok(createQueueApp());
      const manager = new MemoryQueueManager();
      const service = new LinksQueueService(manager);
      await service.createQueue('smoke');
      const result = await service.enqueue('smoke', { hello: 'world' });
      assert.ok(result);
      assert.ok(LinksQueueModule.forRoot());
      const app = Fastify();
      await app.register(plugin);
      await app.ready();
      await app.close();
    `
      );
      run(process.execPath, ['smoke.mjs'], dir);
      writeFileSync(
        join(dir, 'types.mts'),
        `
      import * as core from 'links-queue';
      import express from 'links-queue/express';
      import fastify from 'links-queue/fastify';
      import hono from 'links-queue/hono';
      import nestjs from 'links-queue/nestjs';
      void [core, express, fastify, hono, nestjs];
    `
      );
      run(
        process.execPath,
        [
          'node_modules/typescript/bin/tsc',
          '--noEmit',
          '--skipLibCheck',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          'types.mts',
        ],
        dir
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
