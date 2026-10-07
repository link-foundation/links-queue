/** Tests that the self-referencing specification example matches the wire format. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BinaryNotation,
  HEADER_SIZE,
  encodeLinkBody,
  decodeLinkBody,
  linkBodySize,
} from '../src/protocol/binary-notation.js';

const specification = readFileSync(
  new URL('../../docs/BINARY-NOTATION-SPEC.md', import.meta.url),
  'utf8'
);
const example = specification
  .split('### Self-Referencing Link')[1]
  .split('\n### ')[0];
const documentedBody = Uint8Array.from(
  example.matchAll(/^(?:Type|ID|Source|Target): 0x([0-9a-f]+)/gim),
  ([, hex]) => Number.parseInt(hex, 16)
);
const [, text, textBytes] = example.match(
  /Text notation: `([^`]+)` \((\d+) bytes\)/
);
const [, bodyBytes, reduction] = example.match(
  /Total: (\d+) bytes \(([\d.]+)% reduction\)/
);

describe('Self-referencing specification example', () => {
  it('should match the encoded body and decode to the example link', () => {
    const link = { id: 5, source: 5, target: 5 };
    const frame = BinaryNotation.encode(link);
    assert.deepEqual(frame.slice(HEADER_SIZE + 1), documentedBody);
    const decoded = decodeLinkBody(documentedBody, 0);
    assert.equal(decoded.bytesRead, documentedBody.length);
    assert.equal(decoded.link.id, link.id);
    assert.equal(decoded.link.source, link.source);
    assert.equal(decoded.link.target, link.target);
  });

  it('should report the UTF-8 text size accurately', () => {
    assert.equal(new TextEncoder().encode(text).length, Number(textBytes));
  });

  it('should report the body size and reduction without framing overhead', () => {
    const size = linkBodySize({ id: 5, source: 5, target: 5 });
    assert.equal(size, Number(bodyBytes));
    assert.equal(size, documentedBody.length);
    assert.equal(((1 - size / Number(textBytes)) * 100).toFixed(1), reduction);
  });
});

describe('Version 1.0 self-referencing wire format', () => {
  const cases = [
    { id: 5, reference: 5, bytes: [0x0f, 0x05, 0x05] },
    { id: 7, reference: 5, bytes: [0x0f, 0x07, 0x05] },
    { id: 128, reference: 128, bytes: [0x0f, 0x80, 0x01, 0x80, 0x01] },
    { id: null, reference: 5, bytes: [0x07, 0x05] },
  ];

  for (const { id, reference, bytes } of cases) {
    it(`should encode ID ${id} and shared reference ${reference}`, () => {
      const link = { id, source: reference, target: reference };
      const body = Uint8Array.from(bytes);
      const buffer = new Uint8Array(body.length);
      assert.equal(encodeLinkBody(link, buffer, 0), body.length);
      assert.equal(linkBodySize(link), body.length);
      assert.deepEqual(buffer, body);
      const decoded = decodeLinkBody(body, 0);
      assert.equal(decoded.bytesRead, body.length);
      assert.equal(decoded.link.id, id ?? 0);
      assert.equal(decoded.link.source, reference);
      assert.equal(decoded.link.target, reference);
    });
  }
});
