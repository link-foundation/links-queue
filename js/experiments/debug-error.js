#!/usr/bin/env node
/**
 * Debug script for error parsing.
 */

import { LinksNotation } from '../src/protocol/notation.js';

// Parse error response notation
const notation =
  "((status error) (error error (code QUEUE_NOT_FOUND) (message 'Queue not found')))";
console.log('Input notation:', notation);

const links = LinksNotation.parse(notation);
console.log('\nParsed links (full structure):');
console.log(JSON.stringify(links, null, 2));

// Check the specific error link part
console.log('\n=== Analyzing structure ===');
console.log('Link source:', JSON.stringify(links[0].source, null, 2));
console.log('Link target:', JSON.stringify(links[0].target, null, 2));
