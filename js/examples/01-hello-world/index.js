/**
 * Hello World Example for links-queue
 *
 * This example demonstrates basic enqueue/dequeue operations using
 * the links-queue library. It shows how to:
 * - Create a queue
 * - Enqueue links (messages)
 * - Dequeue links
 * - Acknowledge processed items
 *
 * Run with any runtime:
 * - Node.js: node examples/01-hello-world/index.js
 * - Bun: bun examples/01-hello-world/index.js
 * - Deno: deno run examples/01-hello-world/index.js
 */

import { createLink, MemoryLinkStore, LinksQueue } from '../../src/index.js';

async function main() {
  console.log('=== Links Queue: Hello World ===\n');

  // Create a MemoryLinkStore for storing links
  const store = new MemoryLinkStore();

  // Create a queue with basic configuration
  const queue = new LinksQueue({
    name: 'hello-world',
    store,
    options: {
      visibilityTimeout: 30, // seconds
      retryLimit: 3,
    },
  });

  // Create some links to enqueue
  // Links are the fundamental data unit - they have id, source, and target
  const greetingLink = createLink(1, 'hello', 'world');
  const messageLink = createLink(2, 'links', 'queue');
  const dataLink = createLink(3, 42, 100);

  console.log('Created links:');
  console.log('  Greeting:', greetingLink);
  console.log('  Message:', messageLink);
  console.log('  Data:', dataLink);

  // Enqueue links
  console.log('\n--- Enqueuing links ---');
  const result1 = await queue.enqueue(greetingLink);
  console.log(`Enqueued link 1 at position ${result1.position}`);

  const result2 = await queue.enqueue(messageLink);
  console.log(`Enqueued link 2 at position ${result2.position}`);

  const result3 = await queue.enqueue(dataLink);
  console.log(`Enqueued link 3 at position ${result3.position}`);

  // Check queue stats
  const stats = queue.getStats();
  console.log('\nQueue stats after enqueueing:');
  console.log(`  Depth: ${stats.depth}`);
  console.log(`  Enqueued: ${stats.enqueued}`);

  // Dequeue and process links
  console.log('\n--- Dequeuing and processing ---');

  // Dequeue first link
  const item1 = await queue.dequeue();
  if (item1) {
    console.log(`Processing: ${item1.source} -> ${item1.target}`);
    // Acknowledge successful processing
    await queue.acknowledge(item1.id);
    console.log(`Acknowledged link ${item1.id}`);
  }

  // Dequeue second link
  const item2 = await queue.dequeue();
  if (item2) {
    console.log(`Processing: ${item2.source} -> ${item2.target}`);
    await queue.acknowledge(item2.id);
    console.log(`Acknowledged link ${item2.id}`);
  }

  // Dequeue third link
  const item3 = await queue.dequeue();
  if (item3) {
    console.log(`Processing: ${item3.source} -> ${item3.target}`);
    await queue.acknowledge(item3.id);
    console.log(`Acknowledged link ${item3.id}`);
  }

  // Final stats
  const finalStats = queue.getStats();
  console.log('\nFinal queue stats:');
  console.log(`  Depth: ${finalStats.depth}`);
  console.log(`  Enqueued: ${finalStats.enqueued}`);
  console.log(`  Dequeued: ${finalStats.dequeued}`);
  console.log(`  Acknowledged: ${finalStats.acknowledged}`);

  // Try to dequeue from empty queue
  const empty = await queue.dequeue();
  console.log(`\nDequeue from empty queue: ${empty}`); // null

  console.log('\n=== Hello World Complete! ===');
}

// Run the example
main().catch(console.error);
