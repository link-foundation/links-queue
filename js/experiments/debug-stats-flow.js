#!/usr/bin/env node
/**
 * Debug script for tracing the stats request/response flow.
 */

import {
  Message,
  createOkResponse,
  createGetStatsRequest,
} from '../src/protocol/messages.js';

// Simulate what the queue returns
const queueStats = {
  depth: 2,
  enqueued: 2,
  dequeued: 0,
  acknowledged: 0,
};

console.log('=== Step 1: Queue stats object ===');
console.log('queueStats:', JSON.stringify(queueStats, null, 2));

// Simulate what the router does
console.log('\n=== Step 2: Router creates response ===');
const response = createOkResponse(queueStats);
console.log('Response object:', JSON.stringify(response, null, 2));

// Simulate what gets sent over the wire
console.log('\n=== Step 3: Serialize to notation ===');
const notation = response.toNotation();
console.log('Notation:', notation);

// Simulate what client receives
console.log('\n=== Step 4: Parse from notation ===');
const parsed = Message.fromNotation(notation);
console.log('Parsed message:', JSON.stringify(parsed, null, 2));

// What the client returns
console.log('\n=== Step 5: Client returns response.result ===');
console.log('response.result:', JSON.stringify(parsed.result, null, 2));
console.log('response.result.depth:', parsed.result?.depth);
