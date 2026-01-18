#!/usr/bin/env node
/**
 * Debug the link structure of arrays.
 */

import { LinksNotation } from '../src/protocol/notation.js';

// Parse the notation that represents the list queues response
const notation =
  '((status ok) (result (queues (((name tasks) (depth 5) (createdAt 1234567890)) ((name queue2) (depth 3) (createdAt 1234567891))))))';
console.log('Notation:', notation);

const links = LinksNotation.parse(notation);
console.log('\nParsed link (full structure):');
console.log(JSON.stringify(links[0], null, 2));

// Find the queues value
function findQueues(link) {
  if (!link || typeof link !== 'object') {
    return null;
  }

  if (link.source === 'queues') {
    return link.target;
  }

  if (typeof link.source === 'object') {
    const result = findQueues(link.source);
    if (result) {
      return result;
    }
  }
  if (typeof link.target === 'object') {
    const result = findQueues(link.target);
    if (result) {
      return result;
    }
  }
  if (link.values) {
    for (const v of link.values) {
      const result = findQueues(v);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

const queuesValue = findQueues(links[0]);
console.log('\n=== Queues value (target of "queues" link) ===');
console.log(JSON.stringify(queuesValue, null, 2));

// Check if this looks like an array structure
// Array in Links: source and target are both objects (not strings)
console.log('\n=== Array detection ===');
const sourceIsObject =
  queuesValue?.source &&
  typeof queuesValue.source === 'object' &&
  'source' in queuesValue.source;
const targetIsObject =
  queuesValue?.target &&
  typeof queuesValue.target === 'object' &&
  'source' in queuesValue.target;
console.log('source is object (link):', sourceIsObject);
console.log('target is object (link):', targetIsObject);
console.log(
  'Both are objects (array pattern):',
  sourceIsObject && targetIsObject
);
