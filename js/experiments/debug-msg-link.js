#!/usr/bin/env node
/**
 * Debug the exact Link structure produced by createOkResponse for list queues.
 */

import { createOkResponse } from '../src/protocol/messages.js';
import { LinksNotation } from '../src/protocol/notation.js';

// Simulate what the router returns
const queues = [
  { name: 'tasks', depth: 5, createdAt: 1234567890 },
  { name: 'queue2', depth: 3, createdAt: 1234567891 },
];

const response = createOkResponse({ queues });

console.log('Response object:');
console.log(JSON.stringify(response, null, 2));

console.log('\n=== Converting to Link ===');
const link = response.toLink();
console.log('Link structure (pretty):');
console.log(JSON.stringify(link, null, 2));

// Now try manual conversion with logging
console.log('\n=== Try stringify directly ===');
try {
  const notation = LinksNotation.stringify(link);
  console.log('Success! Notation:', notation);
} catch (e) {
  console.error('Error:', e.message);
  console.error('Stack:', e.stack);
}
