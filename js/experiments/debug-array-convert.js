#!/usr/bin/env node
/**
 * Debug script for array Link to LinoLink conversion.
 */

import { Link as LinoLink } from 'links-notation';
import { createLink, isLink, getLinkId } from '../src/index.js';

// Log convert function (same as notation.js but with logging)
function convertRefToLinoValue(ref) {
  if (ref === null || ref === undefined) {
    return '';
  }
  if (isLink(ref)) {
    return ref;
  }
  return String(ref);
}

function convertLinkToLinoLink(link, depth = 0) {
  const indent = '  '.repeat(depth);
  console.log(
    `${indent}convertLinkToLinoLink called with:`,
    `${JSON.stringify(link)?.substring(0, 150)}...`
  );

  if (!link) {
    return new LinoLink(null, []);
  }

  if (!isLink(link)) {
    console.log(
      `${indent}  -> not a link, returning LinoLink(${String(link)}, [])`
    );
    return new LinoLink(String(link), []);
  }

  const source = convertRefToLinoValue(link.source);
  const target = convertRefToLinoValue(link.target);

  console.log(
    `${indent}  source type:`,
    typeof source,
    typeof source !== 'string' ? '(LINK)' : source
  );
  console.log(
    `${indent}  target type:`,
    typeof target,
    typeof target !== 'string' ? '(LINK)' : target
  );

  const sourceId = getLinkId(link.source);
  const targetId = getLinkId(link.target);

  if (sourceId === targetId && !link.values?.length) {
    console.log(`${indent}  -> named link, source is:`, typeof source, source);
    if (typeof source === 'string') {
      return new LinoLink(source, []);
    } else {
      // Source is a link - this is the problematic case
      console.log(
        `${indent}  -> ERROR: Named link but source is not a string!`
      );
      console.log(`${indent}     source obj:`, JSON.stringify(source));
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
    console.log(`${indent}  Processing ${link.values.length} values...`);
    for (const val of link.values) {
      const converted = convertRefToLinoValue(val);
      console.log(
        `${indent}    value converted type:`,
        typeof converted,
        typeof converted !== 'string' ? '(LINK)' : converted
      );
      values.push(
        typeof converted === 'string'
          ? new LinoLink(converted, [])
          : convertLinkToLinoLink(converted, depth + 1)
      );
    }
  }

  console.log(
    `${indent}  -> returning LinoLink(null, [${values.length} values])`
  );
  return new LinoLink(null, values);
}

// Create the exact structure that fails - from the debug output
// The queues array converted structure
const queueItem1 = createLink(
  0,
  createLink(0, 'name', 'tasks'),
  createLink(1, 'depth', '5'),
  [createLink(2, 'createdAt', '1234567890')]
);

const queueItem2 = createLink(
  0,
  createLink(0, 'name', 'queue2'),
  createLink(1, 'depth', '3'),
  [createLink(2, 'createdAt', '1234567891')]
);

// Array structure from #convertPayloadToLink
const queuesArray = createLink(0, queueItem1, queueItem2);

console.log('=== Queues array structure ===');
console.log(JSON.stringify(queuesArray, null, 2));

console.log('\n=== Converting to LinoLink ===');
try {
  const result = convertLinkToLinoLink(queuesArray);
  console.log('\n=== Format result ===');
  console.log(result.format());
} catch (e) {
  console.error('\n=== ERROR ===');
  console.error(e.message);
}
