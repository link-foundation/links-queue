#!/usr/bin/env node
/**
 * Debug list queues response parsing.
 */

import { Message, createOkResponse } from '../src/protocol/messages.js';

// Simulate what the router returns
const queues = [
  { name: 'tasks', depth: 5, createdAt: 1234567890 },
  { name: 'queue2', depth: 3, createdAt: 1234567891 },
];

const response = createOkResponse({ queues });

console.log('=== Step 1: Original response ===');
console.log('response.result:', JSON.stringify(response.result, null, 2));
console.log(
  'Array.isArray(response.result.queues):',
  Array.isArray(response.result.queues)
);

console.log('\n=== Step 2: Convert to notation ===');
const notation = response.toNotation();
console.log('Notation:', notation);

console.log('\n=== Step 3: Parse from notation ===');
const parsed = Message.fromNotation(notation);
console.log('parsed.result:', JSON.stringify(parsed.result, null, 2));
console.log(
  'parsed.result.queues:',
  JSON.stringify(parsed.result?.queues, null, 2)
);
console.log(
  'Array.isArray(parsed.result.queues):',
  Array.isArray(parsed.result?.queues)
);
