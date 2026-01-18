#!/usr/bin/env node
/**
 * Debug stringify conversion.
 */

import {
  Link as LinoLink,
  formatLinks,
  FormatOptions as LinoFormatOptions,
} from 'links-notation';
import { createLink, isLink, getLinkId } from '../src/index.js';
import { createOkResponse } from '../src/protocol/messages.js';

// Copy of #convertRefToLinoValue
function convertRefToLinoValue(ref) {
  if (ref === null || ref === undefined) {
    return '';
  }
  if (isLink(ref)) {
    return ref;
  }
  return String(ref);
}

// Copy of #convertLinkToLinoLink with logging
function convertLinkToLinoLink(link, depth = 0) {
  const indent = '  '.repeat(depth);

  if (!link) {
    return new LinoLink(null, []);
  }

  if (!isLink(link)) {
    return new LinoLink(String(link), []);
  }

  const source = convertRefToLinoValue(link.source);
  const target = convertRefToLinoValue(link.target);

  const sourceId = getLinkId(link.source);
  const targetId = getLinkId(link.target);

  if (sourceId === targetId && !link.values?.length) {
    // Named link path - if source is a link, we need to handle it
    if (typeof source === 'string') {
      return new LinoLink(source, []);
    } else {
      // Source is a link - need to convert it, not use it as id
      // This is the bug - should NOT be a named link if source is complex
    }
  }

  const values = [
    typeof source === 'string'
      ? new LinoLink(source, [])
      : convertLinkToLinoLink(source, depth + 1),
    typeof target === 'string'
      ? new LinoLink(target, [])
      : convertLinkToLinoLink(target, depth + 1),
  ];

  if (link.values && link.values.length > 0) {
    for (const val of link.values) {
      const converted = convertRefToLinoValue(val);
      values.push(
        typeof converted === 'string'
          ? new LinoLink(converted, [])
          : convertLinkToLinoLink(converted, depth + 1)
      );
    }
  }

  return new LinoLink(null, values);
}

// Setup
const queues = [
  { name: 'tasks', depth: 5, createdAt: 1234567890 },
  { name: 'queue2', depth: 3, createdAt: 1234567891 },
];
const response = createOkResponse({ queues });
const link = response.toLink();

console.log('=== Testing conversion ===');
const linoLink = convertLinkToLinoLink(link);

console.log('\n=== LinoLink structure ===');
console.log('id:', linoLink.id);
console.log('values count:', linoLink.values?.length);

function printLinoLink(ll, depth = 0) {
  const indent = '  '.repeat(depth);
  console.log(
    `${indent}LinoLink id: ${ll.id}, values: ${ll.values?.length || 0}`
  );
  if (ll.values) {
    for (const v of ll.values) {
      if (v && v.values !== undefined) {
        printLinoLink(v, depth + 1);
      } else {
        console.log(`${indent}  non-link value:`, v);
      }
    }
  }
}

printLinoLink(linoLink);

console.log('\n=== Try formatting ===');
try {
  const formatted = linoLink.format();
  console.log('Formatted:', formatted);
} catch (e) {
  console.error('Format error:', e.message);
}

console.log('\n=== Try formatLinks ===');
try {
  const result = formatLinks([linoLink], false);
  console.log('Result:', result);
} catch (e) {
  console.error('formatLinks error:', e.message);
}
