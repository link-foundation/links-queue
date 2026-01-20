/**
 * Deduplication Example for links-queue
 *
 * This example demonstrates automatic link deduplication - one of the
 * unique features of Links Queue. When you create links with identical
 * source and target, the system automatically returns the existing link
 * instead of creating duplicates.
 *
 * Run with any runtime:
 * - Node.js: node examples/04-deduplication/index.js
 * - Bun: bun examples/04-deduplication/index.js
 * - Deno: deno run examples/04-deduplication/index.js
 */

import { MemoryLinkStore, LinksQueue, createLink } from '../../src/index.js';

// Part 1: Basic Deduplication
async function demoBasicDeduplication() {
  console.log('--- Part 1: Basic Deduplication ---\n');

  const store = new MemoryLinkStore();

  // Create a link
  const link1 = await store.create('hello', 'world');
  console.log('Created link 1:', link1);
  console.log('  ID:', link1.id);

  // Create another link with the same source and target
  const link2 = await store.create('hello', 'world');
  console.log('\nCreated link 2 (same source/target):', link2);
  console.log('  ID:', link2.id);

  // They are the same link!
  console.log('\nAre they the same link?', link1.id === link2.id);

  // Total count should be 1
  console.log('Total links in store:', await store.count());

  // Different source/target creates a new link
  const link3 = await store.create('hello', 'universe');
  console.log('\nCreated link 3 (different target):', link3);
  console.log('  ID:', link3.id);
  console.log('Total links after link3:', await store.count());
}

// Part 2: Type-aware Deduplication
async function demoTypeDeduplication() {
  console.log('\n--- Part 2: Deduplication with Different Types ---\n');

  const store = new MemoryLinkStore();

  // Number IDs
  const numLink1 = await store.create(1, 2);
  const numLink2 = await store.create(1, 2);
  console.log('Number links deduplicated:', numLink1.id === numLink2.id);

  // String IDs
  const strLink1 = await store.create('a', 'b');
  const strLink2 = await store.create('a', 'b');
  console.log('String links deduplicated:', strLink1.id === strLink2.id);

  // BigInt IDs
  const bigLink1 = await store.create(1n, 2n);
  const bigLink2 = await store.create(1n, 2n);
  console.log('BigInt links deduplicated:', bigLink1.id === bigLink2.id);

  // Type matters! Number 1 vs String "1" are different
  const num1 = await store.create(1, 2);
  const str1 = await store.create('1', '2');
  console.log('Number vs String (different):', num1.id !== str1.id);

  console.log('Total unique links:', await store.count());
}

// Part 3: Nested Link Deduplication
async function demoNestedDeduplication() {
  console.log('\n--- Part 3: Nested Link Deduplication ---\n');

  const store = new MemoryLinkStore();

  // Create inner links
  const inner1 = await store.create(10, 20);
  const inner2 = await store.create(10, 20);
  console.log('Inner links are same:', inner1.id === inner2.id);

  // Create outer links using the inner link as source
  const outer1 = await store.create(inner1, 30);
  const outer2 = await store.create(inner2, 30);
  console.log(
    'Outer links with same nested source are same:',
    outer1.id === outer2.id
  );
  console.log('Total links (1 inner + 1 outer):', await store.count());
}

// Part 4: Universal Links (No Deduplication)
async function demoUniversalLinks() {
  console.log('\n--- Part 4: Universal Links (No Deduplication) ---\n');

  const store = new MemoryLinkStore();

  // Universal links with values are NOT deduplicated
  const universal1 = await store.createWithValues('subject', 'predicate', [
    'object1',
  ]);
  const universal2 = await store.createWithValues('subject', 'predicate', [
    'object1',
  ]);

  console.log('Universal link 1:', universal1);
  console.log('Universal link 2:', universal2);
  console.log('Same ID?', universal1.id === universal2.id);
  console.log('Total universal links:', await store.count());
}

// Part 5: Event Deduplication Use Case
async function demoEventDeduplication() {
  console.log('\n--- Part 5: Practical Use Case - Event Deduplication ---\n');

  const eventStore = new MemoryLinkStore();
  const eventQueue = new LinksQueue({ name: 'events', store: eventStore });

  const events = [
    { type: 'user_login', userId: 'user123' },
    { type: 'user_login', userId: 'user123' }, // Duplicate!
    { type: 'user_logout', userId: 'user123' },
    { type: 'user_login', userId: 'user456' },
    { type: 'user_login', userId: 'user123' }, // Duplicate!
  ];

  console.log('Processing events with deduplication:');

  const processedIds = new Set();
  for (const event of events) {
    const eventLink = await eventStore.create(event.type, event.userId);

    if (processedIds.has(eventLink.id)) {
      console.log(`  SKIPPED (duplicate): ${event.type} - ${event.userId}`);
      continue;
    }

    const completeLink = createLink(
      eventLink.id,
      eventLink.source,
      eventLink.target
    );
    await eventQueue.enqueue(completeLink);
    processedIds.add(eventLink.id);
    console.log(
      `  ENQUEUED: ${event.type} - ${event.userId} (id: ${eventLink.id})`
    );
  }

  console.log('\nQueue stats:');
  const stats = eventQueue.getStats();
  console.log(`  Events in queue: ${stats.depth}`);
  console.log(`  Unique events: ${processedIds.size}`);
  console.log(`  Duplicates filtered: ${events.length - processedIds.size}`);
}

// Part 6: Pattern-Based Duplicate Check
async function demoPatternCheck() {
  console.log('\n--- Part 6: Pattern-Based Duplicate Check ---\n');

  const store = new MemoryLinkStore();

  await store.create('api-call', '/users');
  await store.create('api-call', '/products');
  await store.create('api-call', '/orders');
  await store.create('database-query', 'SELECT * FROM users');

  const existingApiCalls = await store.find({ source: 'api-call' });
  console.log('Existing API calls:', existingApiCalls.length);

  const newEndpoint = '/users';
  const existing = await store.find({
    source: 'api-call',
    target: newEndpoint,
  });

  if (existing.length > 0) {
    console.log(
      `API call to ${newEndpoint} already tracked (id: ${existing[0].id})`
    );
  } else {
    const newLink = await store.create('api-call', newEndpoint);
    console.log(`New API call tracked: ${newLink.id}`);
  }
}

// Main function
async function main() {
  console.log('=== Links Queue: Deduplication ===\n');

  await demoBasicDeduplication();
  await demoTypeDeduplication();
  await demoNestedDeduplication();
  await demoUniversalLinks();
  await demoEventDeduplication();
  await demoPatternCheck();

  console.log('\n=== Deduplication Complete! ===');
}

// Run the example
main().catch(console.error);
