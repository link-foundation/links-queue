#!/usr/bin/env node
/**
 * Debug script for stats response.
 */

import { Message, createOkResponse } from '../src/protocol/messages.js';

// Create a stats response
const statsResponse = createOkResponse({
  depth: 2,
  enqueued: 2,
  dequeued: 0,
  acknowledged: 0,
});

console.log('Original stats response:', JSON.stringify(statsResponse, null, 2));

const notation = statsResponse.toNotation();
console.log('\nAs notation:', notation);

const parsed = Message.fromNotation(notation);
console.log('\nParsed back:', JSON.stringify(parsed, null, 2));

// Check if depth is accessible
console.log('\nresult.depth:', parsed.result?.depth);
