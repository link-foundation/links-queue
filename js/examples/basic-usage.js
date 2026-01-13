/**
 * Basic usage examples for links-queue
 *
 * This file demonstrates the core Link and LinkStore interfaces.
 *
 * Run with any runtime:
 * - Node.js: node examples/basic-usage.js
 * - Bun: bun examples/basic-usage.js
 * - Deno: deno run examples/basic-usage.js
 */

import {
  Any,
  isLink,
  isLinkId,
  isLinkRef,
  getLinkId,
  createLink,
  matchesPattern,
} from '../src/index.js';

// =============================================================================
// Creating Links
// =============================================================================

console.log('=== Creating Links ===\n');

// Simple link with numeric IDs
const simpleLink = createLink(1, 2, 3);
console.log('Simple link:', simpleLink);
// Output: { id: 1, source: 2, target: 3 }

// Link with bigint IDs (for large datasets)
const bigintLink = createLink(1n, 9007199254740993n, 9007199254740994n);
console.log('Bigint link:', bigintLink);

// Link with string IDs (for UUID-based systems)
const uuidLink = createLink('link-001', 'source-uuid-123', 'target-uuid-456');
console.log('UUID link:', uuidLink);

// =============================================================================
// Nested Links (Recursive Structures)
// =============================================================================

console.log('\n=== Nested Links ===\n');

// Create nested link structures for representing complex relationships
const personType = createLink(10, 0, 0); // A "type" link
const nameProperty = createLink(11, 0, 0); // A "name" property link
const person = createLink(1, personType, nameProperty);
console.log('Person link with type and name:', person);

// Deep nesting: (1: (2: (3: 30 31)))
const level3 = createLink(3, 30, 31);
const level2 = createLink(2, level3, 21);
const level1 = createLink(1, level2, 11);
console.log('Deeply nested:', level1);
console.log('  Level 1 source ID:', level1.source.id); // 2
console.log('  Level 2 source ID:', level1.source.source.id); // 3

// =============================================================================
// Universal Links (Variable Number of References)
// =============================================================================

console.log('\n=== Universal Links ===\n');

// Universal link with additional values beyond source/target
// Useful for n-ary relationships
const tripleRelation = createLink(
  100, // id
  1, // source (subject)
  2, // target (predicate)
  [3, 4, 5] // values (objects)
);
console.log('Triple+ relation:', tripleRelation);

// =============================================================================
// Type Checking
// =============================================================================

console.log('\n=== Type Checking ===\n');

console.log(
  'isLink({ id: 1, source: 2, target: 3 }):',
  isLink({ id: 1, source: 2, target: 3 })
); // true
console.log('isLink(42):', isLink(42)); // false
console.log('isLink(null):', isLink(null)); // false

console.log('isLinkId(42):', isLinkId(42)); // true
console.log('isLinkId(1n):', isLinkId(1n)); // true
console.log('isLinkId("uuid"):', isLinkId('uuid')); // true
console.log('isLinkId({}):', isLinkId({})); // false

console.log('isLinkRef(42):', isLinkRef(42)); // true
console.log('isLinkRef(simpleLink):', isLinkRef(simpleLink)); // true

// =============================================================================
// Extracting IDs
// =============================================================================

console.log('\n=== Extracting IDs ===\n');

console.log('getLinkId(42):', getLinkId(42)); // 42
console.log('getLinkId(simpleLink):', getLinkId(simpleLink)); // 1

const nestedSource = createLink(5, 50, 51);
const linkWithNestedSource = createLink(1, nestedSource, 10);
console.log(
  'getLinkId(linkWithNestedSource.source):',
  getLinkId(linkWithNestedSource.source)
); // 5

// =============================================================================
// Pattern Matching
// =============================================================================

console.log('\n=== Pattern Matching ===\n');

const links = [
  createLink(1, 10, 20),
  createLink(2, 10, 30),
  createLink(3, 20, 30),
  createLink(4, 30, 40),
];

// Find links with source = 10
const sourcePattern = { source: 10 };
const withSource10 = links.filter((link) =>
  matchesPattern(link, sourcePattern)
);
console.log(
  'Links with source=10:',
  withSource10.map((l) => l.id)
); // [1, 2]

// Find links with target = 30
const targetPattern = { target: 30 };
const withTarget30 = links.filter((link) =>
  matchesPattern(link, targetPattern)
);
console.log(
  'Links with target=30:',
  withTarget30.map((l) => l.id)
); // [2, 3]

// Find links with any source and target = 30
const anySourcePattern = { source: Any, target: 30 };
const anySourceTarget30 = links.filter((link) =>
  matchesPattern(link, anySourcePattern)
);
console.log(
  'Links with Any source, target=30:',
  anySourceTarget30.map((l) => l.id)
); // [2, 3]

// Match all links
const allPattern = { source: Any, target: Any };
const allMatched = links.filter((link) => matchesPattern(link, allPattern));
console.log('All links (Any, Any):', allMatched.length); // 4

console.log('\n=== Done ===\n');
