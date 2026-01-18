#!/usr/bin/env node
/**
 * Debug script for list queues response serialization.
 */

import { Message, createOkResponse } from '../src/protocol/messages.js';

// Simulate what the router returns
const queues = [
  { name: 'tasks', depth: 5, createdAt: 1234567890 },
  { name: 'queue2', depth: 3, createdAt: 1234567891 },
];

const response = createOkResponse({ queues });

console.log('Response object:');
console.log(JSON.stringify(response, null, 2));

console.log('\nConverting to Link...');
const link = response.toLink();
console.log('Link structure:');
console.log(JSON.stringify(link, null, 2));

console.log('\nConverting to notation...');
try {
  const notation = response.toNotation();
  console.log('Notation:', notation);
} catch (e) {
  console.error('Error converting to notation:', e);
}
