#!/usr/bin/env node
/**
 * Debug script for understanding Link parsing structure.
 */

import { LinksNotation } from '../src/protocol/notation.js';

// Parse a result notation
const notation = '((status ok) (result ((id abc123) (position 0))))';
console.log('Input notation:', notation);

const links = LinksNotation.parse(notation);
console.log('\nParsed links:');
console.log(JSON.stringify(links, null, 2));

// Now parse just the result part
const resultNotation = '(result ((id abc123) (position 0)))';
console.log('\n\nResult only notation:', resultNotation);

const resultLinks = LinksNotation.parse(resultNotation);
console.log('\nParsed result links:');
console.log(JSON.stringify(resultLinks, null, 2));

// And the inner content
const innerNotation = '((id abc123) (position 0))';
console.log('\n\nInner only notation:', innerNotation);

const innerLinks = LinksNotation.parse(innerNotation);
console.log('\nParsed inner links:');
console.log(JSON.stringify(innerLinks, null, 2));
