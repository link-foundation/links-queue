#!/usr/bin/env node
/**
 * Debug script for analyzing message serialization/deserialization.
 */

import {
  Message,
  createOkResponse,
  createErrorResponse,
  createEnqueueRequest,
  createCreateQueueRequest,
  ErrorCode,
  ResponseStatus,
} from '../src/protocol/messages.js';
import { LinksNotation } from '../src/protocol/notation.js';

// Test error response
console.log('=== Testing Error Response ===');
const errorResponse = createErrorResponse(
  ErrorCode.QUEUE_NOT_FOUND,
  'Queue not found'
);
console.log('Original error response:', JSON.stringify(errorResponse, null, 2));

const errorNotation = errorResponse.toNotation();
console.log('As notation:', errorNotation);

const parsedError = Message.fromNotation(errorNotation);
console.log('Parsed back:', JSON.stringify(parsedError, null, 2));

console.log('\n=== Testing OK Response ===');
const okResponse = createOkResponse({ id: 'abc123', position: 0 });
console.log('Original ok response:', JSON.stringify(okResponse, null, 2));

const okNotation = okResponse.toNotation();
console.log('As notation:', okNotation);

const parsedOk = Message.fromNotation(okNotation);
console.log('Parsed back:', JSON.stringify(parsedOk, null, 2));

console.log('\n=== Testing Create Queue Request ===');
const createRequest = createCreateQueueRequest('tasks');
console.log('Original request:', JSON.stringify(createRequest, null, 2));

const createNotation = createRequest.toNotation();
console.log('As notation:', createNotation);

const parsedCreate = Message.fromNotation(createNotation);
console.log('Parsed back:', JSON.stringify(parsedCreate, null, 2));

console.log('\n=== Testing Enqueue Request ===');
const enqueueRequest = createEnqueueRequest('tasks', {
  source: 'test',
  target: 'data',
});
console.log('Original request:', JSON.stringify(enqueueRequest, null, 2));

const enqueueNotation = enqueueRequest.toNotation();
console.log('As notation:', enqueueNotation);

const parsedEnqueue = Message.fromNotation(enqueueNotation);
console.log('Parsed back:', JSON.stringify(parsedEnqueue, null, 2));
