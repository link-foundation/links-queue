/**
 * Debug script for nested link encoding/decoding.
 */

import { createLink, isLink } from '../src/index.js';
import {
  BinaryNotation,
  LITERAL_LINK,
  TYPE_SOURCE_IS_ID,
  TYPE_TARGET_IS_ID,
} from '../src/protocol/binary-notation.js';

// Create test links
const inner1 = createLink(1, 2, 3);
const inner2 = createLink(4, 5, 6);
const outer = createLink(100, inner1, inner2);

console.log('=== Input ===');
console.log('inner1:', inner1);
console.log('inner2:', inner2);
console.log('outer:', outer);
console.log('isLink(inner1):', isLink(inner1));
console.log('isLink(outer.source):', isLink(outer.source));

// Encode
console.log('\n=== Encoding ===');
const encoded = BinaryNotation.encode([outer]);
console.log('Encoded bytes:', encoded.length);
console.log('Encoded (hex):', Buffer.from(encoded).toString('hex'));

// Show individual bytes
console.log('\nByte breakdown:');
for (let i = 0; i < encoded.length; i++) {
  console.log(
    `  [${i.toString().padStart(2)}] 0x${encoded[i].toString(16).padStart(2, '0')} (${encoded[i]})`
  );
}

// Check type byte at position 12 (after 11-byte header + 1 link count)
console.log('\n=== Analysis ===');
const headerSize = 11;
console.log(`Header ends at byte ${headerSize - 1}`);
console.log(`Link count varint starts at byte ${headerSize}`);

// Decode
console.log('\n=== Decoding ===');
try {
  const decoded = BinaryNotation.decode(encoded);
  console.log('Decoded length:', decoded.length);
  if (decoded.length > 0) {
    console.log('Decoded[0].id:', decoded[0].id);
    console.log('Decoded[0].source:', decoded[0].source);
    console.log('Decoded[0].source type:', typeof decoded[0].source);
    console.log('isLink(decoded[0].source):', isLink(decoded[0].source));
    console.log('Decoded[0].target:', decoded[0].target);
    console.log('Decoded[0].target type:', typeof decoded[0].target);
    console.log('isLink(decoded[0].target):', isLink(decoded[0].target));
  }
} catch (err) {
  console.error('Decode error:', err);
}

// Test basic nested link
console.log('\n=== Simple test ===');
const simple = createLink(10, 20, 30);
console.log('simple link:', simple);
const simpleEncoded = BinaryNotation.encode([simple]);
const simpleDecoded = BinaryNotation.decode(simpleEncoded);
console.log('simple decoded:', simpleDecoded[0]);
