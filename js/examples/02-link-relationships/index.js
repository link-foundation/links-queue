/**
 * Link Relationships Example for links-queue
 *
 * This example demonstrates nested links and graph structures.
 * Links Queue uses a unique link-based data model where:
 * - Each link has an id, source, and target
 * - Source and target can be IDs or nested links
 * - This allows representing complex relationships and graph structures
 *
 * Run with any runtime:
 * - Node.js: node examples/02-link-relationships/index.js
 * - Bun: bun examples/02-link-relationships/index.js
 * - Deno: deno run examples/02-link-relationships/index.js
 */

import {
  createLink,
  MemoryLinkStore,
  LinksQueue,
  getLinkId,
  isLink,
  matchesPattern,
  Any,
} from '../../src/index.js';

// Part 1: Basic Links as Relations
function demoBasicRelations() {
  console.log('--- Part 1: Basic Links as Relations ---\n');

  // Links naturally represent relationships (edges in a graph)
  const alice = 'alice';
  const bob = 'bob';
  const knowsRelation = createLink(1, alice, bob);
  console.log('Alice knows Bob:', knowsRelation);

  // Representing a typed relationship
  const personType = 100;
  const alicePerson = createLink(2, personType, alice);
  const aliceName = createLink(3, alicePerson, 'Alice Smith');
  console.log('Alice person link:', alicePerson);
  console.log('Alice name link:', aliceName);

  return { alice, bob };
}

// Part 2: Nested Links (Recursive Structures)
function demoNestedLinks(alice, bob) {
  console.log('\n--- Part 2: Nested Links (Recursive Structures) ---\n');

  // First, the base relationship
  const aliceKnowsBob = createLink(10, alice, bob);

  // Then, a link about that relationship (meta-link)
  const establishedIn = createLink(11, aliceKnowsBob, 2024);
  console.log('Nested link (statement about relationship):');
  console.log('  Base:', aliceKnowsBob);
  console.log('  Meta:', establishedIn);

  // Accessing nested data
  if (isLink(establishedIn.source)) {
    console.log(
      '  Established relationship:',
      establishedIn.source.source,
      '->',
      establishedIn.source.target
    );
    console.log('  In year:', establishedIn.target);
  }
}

// Part 3: Universal Links (Multiple Values)
function demoUniversalLinks() {
  console.log('\n--- Part 3: Universal Links (Multiple Values) ---\n');

  // Universal links for n-ary relations
  const subject = 'Earth';
  const predicate = 'orbits';
  const object = 'Sun';
  const confidence = 0.999;
  const source = 'astronomy';

  const universalLink = createLink(20, subject, predicate, [
    object,
    confidence,
    source,
  ]);
  console.log('Universal link (n-ary relation):', universalLink);
  console.log('  Subject:', universalLink.source);
  console.log('  Predicate:', universalLink.target);
  console.log('  Additional values:', universalLink.values);
}

// Part 4: Graph Structures
function demoGraphStructures() {
  console.log('\n--- Part 4: Graph Structures ---\n');

  const users = { alice: 'alice', bob: 'bob', charlie: 'charlie' };

  const graph = [
    createLink(30, users.alice, users.bob),
    createLink(31, users.bob, users.charlie),
    createLink(32, users.alice, users.charlie),
    createLink(33, users.charlie, users.alice),
  ];

  console.log('Social graph edges:');
  graph.forEach((link) => {
    console.log(`  ${link.source} -> ${link.target}`);
  });

  // Find all connections from Alice
  const aliceConnections = graph.filter((link) =>
    matchesPattern(link, { source: users.alice })
  );
  console.log('\nAlice is connected to:');
  aliceConnections.forEach((link) => {
    console.log(`  ${link.target}`);
  });

  // Find all connections to Charlie
  const charlieIncoming = graph.filter((link) =>
    matchesPattern(link, { target: users.charlie })
  );
  console.log('\nCharlie receives connections from:');
  charlieIncoming.forEach((link) => {
    console.log(`  ${link.source}`);
  });
}

// Part 5: Processing Graph Operations via Queue
async function demoQueueOperations() {
  console.log('\n--- Part 5: Processing Graph Operations via Queue ---\n');

  const store = new MemoryLinkStore();
  const queue = new LinksQueue({ name: 'graph-operations', store });

  const ADD_EDGE = 'add_edge';
  const REMOVE_EDGE = 'remove_edge';
  const QUERY = 'query';

  // Queue up some graph operations
  const operations = [
    createLink(100, ADD_EDGE, createLink(101, 'node1', 'node2')),
    createLink(102, ADD_EDGE, createLink(103, 'node2', 'node3')),
    createLink(104, QUERY, { source: 'node1', target: Any }),
    createLink(105, REMOVE_EDGE, createLink(106, 'node1', 'node2')),
  ];

  // Enqueue operations
  for (const op of operations) {
    await queue.enqueue(op);
    const opType = op.source;
    const opData = isLink(op.target)
      ? `${op.target.source}->${op.target.target}`
      : JSON.stringify(op.target);
    console.log(`Queued: ${opType} ${opData}`);
  }

  // Process operations
  console.log('\nProcessing operations:');
  let item;
  while ((item = await queue.dequeue()) !== null) {
    const operation = item.source;
    const payload = item.target;

    switch (operation) {
      case ADD_EDGE:
        console.log(
          `  ADD: ${getLinkId(payload.source)} -> ${getLinkId(payload.target)}`
        );
        break;
      case REMOVE_EDGE:
        console.log(
          `  REMOVE: ${getLinkId(payload.source)} -> ${getLinkId(payload.target)}`
        );
        break;
      case QUERY:
        console.log(`  QUERY: source=${payload.source}`);
        break;
      default:
        console.log(`  UNKNOWN: ${operation}`);
    }

    await queue.acknowledge(item.id);
  }
}

// Main function
async function main() {
  console.log('=== Links Queue: Link Relationships ===\n');

  const { alice, bob } = demoBasicRelations();
  demoNestedLinks(alice, bob);
  demoUniversalLinks();
  demoGraphStructures();
  await demoQueueOperations();

  console.log('\n=== Link Relationships Complete! ===');
}

// Run the example
main().catch(console.error);
