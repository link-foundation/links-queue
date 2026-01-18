#!/usr/bin/env node
/**
 * Debug script for Link to LinoLink conversion.
 */

import { Link as LinoLink } from 'links-notation';
import { createLink, isLink, getLinkId } from '../src/index.js';

// Minimal convertRefToLinoValue
function convertRefToLinoValue(ref) {
  console.log(
    '  convertRefToLinoValue:',
    typeof ref,
    JSON.stringify(ref)?.substring(0, 100)
  );
  if (ref === null || ref === undefined) {
    return '';
  }
  if (isLink(ref)) {
    return ref;
  }
  return String(ref);
}

// Minimal convertLinkToLinoLink
function convertLinkToLinoLink(link, depth = 0) {
  const indent = '  '.repeat(depth);
  console.log(
    `${indent}convertLinkToLinoLink:`,
    JSON.stringify(link)?.substring(0, 100)
  );

  if (!link) {
    return new LinoLink(null, []);
  }

  if (!isLink(link)) {
    // If it's a primitive value, create a simple reference
    console.log(`${indent}  -> primitive:`, String(link));
    return new LinoLink(String(link), []);
  }

  const source = convertRefToLinoValue(link.source);
  const target = convertRefToLinoValue(link.target);

  console.log(
    `${indent}  source:`,
    typeof source,
    typeof source === 'string' ? source : 'LINK'
  );
  console.log(
    `${indent}  target:`,
    typeof target,
    typeof target === 'string' ? target : 'LINK'
  );

  // Check if this is a self-referencing (named) link
  const sourceId = getLinkId(link.source);
  const targetId = getLinkId(link.target);

  if (sourceId === targetId && !link.values?.length) {
    // Named link: (name: name) -> (name)
    console.log(`${indent}  -> named link:`, source);
    return new LinoLink(source, []);
  }

  // Build values array
  const values = [
    typeof source === 'string'
      ? new LinoLink(source, [])
      : convertLinkToLinoLink(source, depth + 1),
    typeof target === 'string'
      ? new LinoLink(target, [])
      : convertLinkToLinoLink(target, depth + 1),
  ];

  // Add additional values if present
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

  const result = new LinoLink(null, values);
  console.log(
    `${indent}  -> result:`,
    result.id,
    'values:',
    result.values?.length
  );
  return result;
}

// Test with simple case
console.log('=== Simple case ===');
const simpleLink = createLink(0, 'name', 'tasks');
console.log('Input:', JSON.stringify(simpleLink));
const simpleResult = convertLinkToLinoLink(simpleLink);
console.log('Output notation:', simpleResult.format());

// Test with nested case
console.log('\n=== Nested case ===');
const nestedLink = createLink(
  0,
  'queues',
  createLink(0, createLink(0, 'name', 'tasks'), createLink(1, 'depth', '5'))
);
console.log('Input:', JSON.stringify(nestedLink, null, 2));

try {
  const nestedResult = convertLinkToLinoLink(nestedLink);
  console.log('\nOutput notation:', nestedResult.format());
} catch (e) {
  console.error('\nError:', e.message);
  console.error('Stack:', e.stack);
}
