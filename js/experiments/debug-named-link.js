#!/usr/bin/env node
/**
 * Debug the named link issue.
 */

import { createLink, isLink, getLinkId } from '../src/index.js';

// This is what happens when #convertPayloadToLink processes an array
// For array items, it creates: createLink(i, converted, converted)
// where i is index and converted is the array element

// First array item
const item1 = {
  id: 0,
  source: { id: 0, source: 'name', target: 'tasks' },
  target: { id: 1, source: 'depth', target: '5' },
  values: [{ id: 2, source: 'createdAt', target: '1234567890' }],
};

// Second array item
const item2 = {
  id: 0,
  source: { id: 0, source: 'name', target: 'queue2' },
  target: { id: 1, source: 'depth', target: '3' },
  values: [{ id: 2, source: 'createdAt', target: '1234567891' }],
};

// The array container - this is where the problem is
// Array creates: createLink(0, item1, item2)
const arrayLink = { id: 0, source: item1, target: item2 };

console.log('=== Array link structure ===');
console.log('isLink(arrayLink):', isLink(arrayLink));
console.log('isLink(arrayLink.source):', isLink(arrayLink.source));
console.log('isLink(arrayLink.target):', isLink(arrayLink.target));

console.log('\n=== getLinkId ===');
const sourceId = getLinkId(arrayLink.source);
const targetId = getLinkId(arrayLink.target);
console.log('sourceId:', sourceId);
console.log('targetId:', targetId);
console.log('sourceId === targetId:', sourceId === targetId);
console.log('!arrayLink.values?.length:', !arrayLink.values?.length);

// The condition that triggers the named link code path
if (sourceId === targetId && !arrayLink.values?.length) {
  console.log('\n=== BUG TRIGGERED ===');
  console.log('This triggers the named link path, but source is NOT a string!');
  console.log('source type:', typeof arrayLink.source);
}
