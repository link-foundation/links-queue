/**
 * Benchmark tests for MemoryLinkStore implementation.
 *
 * These tests validate performance characteristics:
 * - O(1) access time for get/exists operations
 * - Reasonable performance for find/iterate operations
 * - Memory efficiency with deduplication
 *
 * Run with: node tests/memory.benchmark.js
 */

/* eslint-disable no-unused-vars, no-undef, max-lines-per-function */

import { MemoryLinkStore, Any } from '../src/index.js';

/**
 * Simple benchmark utility
 * @param {string} name - Benchmark name
 * @param {() => Promise<void>} fn - Function to benchmark
 * @param {number} iterations - Number of iterations
 */
async function benchmark(name, fn, iterations = 1000) {
  // Warmup
  for (let i = 0; i < 10; i++) {
    await fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const end = performance.now();

  const totalMs = end - start;
  const avgMs = totalMs / iterations;
  const opsPerSec = Math.round(1000 / avgMs);

  console.log(`${name}:`);
  console.log(`  Total: ${totalMs.toFixed(2)}ms for ${iterations} iterations`);
  console.log(`  Average: ${avgMs.toFixed(4)}ms per operation`);
  console.log(`  Throughput: ${opsPerSec.toLocaleString()} ops/sec`);
  console.log();

  return { name, totalMs, avgMs, opsPerSec };
}

async function runBenchmarks() {
  console.log('='.repeat(60));
  console.log('MemoryLinkStore Performance Benchmarks');
  console.log('='.repeat(60));
  console.log();

  const results = [];

  // ===========================================================================
  // Setup: Populate store with test data
  // ===========================================================================

  const store = new MemoryLinkStore();
  const INITIAL_LINKS = 10000;

  console.log(
    `Setting up store with ${INITIAL_LINKS.toLocaleString()} links...`
  );
  const setupStart = performance.now();

  for (let i = 0; i < INITIAL_LINKS; i++) {
    await store.create(i % 100, (i * 7) % 100);
  }

  const setupTime = performance.now() - setupStart;
  console.log(`Setup completed in ${setupTime.toFixed(2)}ms`);
  console.log(
    `Store contains ${await store.count()} unique links (deduplication in effect)`
  );
  console.log();

  // ===========================================================================
  // Benchmark: Create (new links)
  // ===========================================================================

  let createCounter = INITIAL_LINKS;
  results.push(
    await benchmark(
      'create (new unique link)',
      async () => {
        await store.create(createCounter++, createCounter++);
      },
      10000
    )
  );

  // ===========================================================================
  // Benchmark: Create (deduplicated)
  // ===========================================================================

  results.push(
    await benchmark(
      'create (deduplicated)',
      async () => {
        await store.create(0, 7); // Always same source/target
      },
      10000
    )
  );

  // ===========================================================================
  // Benchmark: Get by ID (O(1) expected)
  // ===========================================================================

  const linkIds = [];
  for await (const link of store.iterate()) {
    linkIds.push(link.id);
    if (linkIds.length >= 1000) {
      break;
    }
  }

  let getIdx = 0;
  results.push(
    await benchmark(
      'get by ID',
      async () => {
        await store.get(linkIds[getIdx++ % linkIds.length]);
      },
      100000
    )
  );

  // ===========================================================================
  // Benchmark: Exists check (O(1) expected)
  // ===========================================================================

  let existsIdx = 0;
  results.push(
    await benchmark(
      'exists check',
      async () => {
        await store.exists(linkIds[existsIdx++ % linkIds.length]);
      },
      100000
    )
  );

  // ===========================================================================
  // Benchmark: Count (no pattern)
  // ===========================================================================

  results.push(
    await benchmark(
      'count (all links)',
      async () => {
        await store.count();
      },
      10000
    )
  );

  // ===========================================================================
  // Benchmark: Count (with pattern)
  // ===========================================================================

  results.push(
    await benchmark(
      'count (with pattern source=50)',
      async () => {
        await store.count({ source: 50 });
      },
      1000
    )
  );

  // ===========================================================================
  // Benchmark: Find (pattern matching)
  // ===========================================================================

  results.push(
    await benchmark(
      'find (pattern source=50)',
      async () => {
        await store.find({ source: 50 });
      },
      1000
    )
  );

  // ===========================================================================
  // Benchmark: Find with Any wildcard
  // ===========================================================================

  results.push(
    await benchmark(
      'find (Any source, target=50)',
      async () => {
        await store.find({ source: Any, target: 50 });
      },
      1000
    )
  );

  // ===========================================================================
  // Benchmark: Update
  // ===========================================================================

  let updateIdx = 0;
  results.push(
    await benchmark(
      'update',
      async () => {
        const id = linkIds[updateIdx++ % linkIds.length];
        await store.update(id, updateIdx, updateIdx + 1);
      },
      10000
    )
  );

  // ===========================================================================
  // Benchmark: Iterate
  // ===========================================================================

  results.push(
    await benchmark(
      'iterate (first 100 links)',
      async () => {
        let count = 0;
        for await (const iterLink of store.iterate()) {
          count++;
          if (count >= 100) {
            break;
          }
        }
      },
      1000
    )
  );

  // ===========================================================================
  // Summary
  // ===========================================================================

  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log();

  // Group by expected O(1) operations
  const o1Operations = ['get by ID', 'exists check', 'count (all links)'];
  const o1Results = results.filter((r) => o1Operations.includes(r.name));

  console.log('O(1) Operations (should have consistent high throughput):');
  for (const r of o1Results) {
    console.log(`  ${r.name}: ${r.opsPerSec.toLocaleString()} ops/sec`);
  }
  console.log();

  console.log('O(n) Operations (pattern matching):');
  const oNResults = results.filter((r) => !o1Operations.includes(r.name));
  for (const r of oNResults) {
    console.log(`  ${r.name}: ${r.opsPerSec.toLocaleString()} ops/sec`);
  }
  console.log();

  // Validate O(1) performance
  const minO1Throughput = 100000; // At least 100k ops/sec for O(1) operations
  const o1Pass = o1Results.every((r) => r.opsPerSec >= minO1Throughput);

  if (o1Pass) {
    console.log('PASS: O(1) operations meet performance threshold');
  } else {
    console.log('WARN: Some O(1) operations below expected threshold');
  }
}

// Run benchmarks
runBenchmarks().catch(console.error);
