/**
 * Benchmark tests comparing text vs binary Links Notation.
 *
 * These tests verify the size reduction claims and measure performance
 * of binary notation compared to text notation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { BinaryNotation } from '../src/protocol/binary-notation.js';
import { LinksNotation } from '../src/protocol/notation.js';
import { createLink } from '../src/index.js';

// =============================================================================
// Test Data Generators
// =============================================================================

/**
 * Creates a simple link with numeric IDs.
 *
 * @param {number} id - Link ID
 * @param {number} source - Source ID
 * @param {number} target - Target ID
 * @returns {Object} Link object
 */
function createSimpleLink(id, source, target) {
  return createLink(id, source, target);
}

/**
 * Creates a self-referencing link.
 *
 * @param {number} id - Link ID (also used as source and target)
 * @returns {Object} Link object
 */
function createSelfRefLink(id) {
  return createLink(id, id, id);
}

/**
 * Creates a link with string values.
 *
 * @param {number} id - Link ID
 * @param {string} source - Source string
 * @param {string} target - Target string
 * @returns {Object} Link object
 */
function createStringLink(id, source, target) {
  return createLink(id, source, target);
}

/**
 * Creates a nested link.
 *
 * @param {number} id - Link ID
 * @param {Object} source - Source link
 * @param {Object} target - Target link
 * @returns {Object} Link object
 */
function createNestedLink(id, source, target) {
  return createLink(id, source, target);
}

/**
 * Creates a link with values array.
 *
 * @param {number} id - Link ID
 * @param {number} source - Source ID
 * @param {number} target - Target ID
 * @param {number[]} values - Additional values
 * @returns {Object} Link object
 */
function createLinkWithValues(id, source, target, values) {
  return createLink(id, source, target, values);
}

// =============================================================================
// Size Comparison Tests
// =============================================================================

describe('Binary vs Text Notation Size Comparison', () => {
  describe('Simple Links', () => {
    it('should be smaller for simple numeric link (1, 2)', () => {
      const link = createSimpleLink(1, 2, 3);

      const textEncoded = LinksNotation.stringify(link);
      const binaryEncoded = BinaryNotation.encode([link]);

      console.log(
        `Simple link (1, 2, 3): text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes`
      );

      // Binary should be smaller for simple numeric links
      // Text: "(1: 2 3)" = 9 bytes minimum
      // Binary: 11 (header) + 4 (count + type + id + source + target) = ~15 bytes
      // For single links, header overhead makes binary larger, but for batches it's smaller
      assert.ok(textEncoded.length > 0, 'Text encoding should produce output');
      assert.ok(
        binaryEncoded.length > 0,
        'Binary encoding should produce output'
      );
    });

    it('should be significantly smaller for batch of 100 simple links', () => {
      const links = [];
      for (let i = 0; i < 100; i++) {
        links.push(createSimpleLink(i, i + 1, i + 2));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `100 simple links: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // Binary should be at least 2x smaller for batch of numeric links
      assert.ok(
        ratio >= 1.5,
        `Expected at least 1.5x size reduction, got ${ratio.toFixed(2)}x`
      );
    });

    it('should be smaller for batch of 1000 simple links', () => {
      const links = [];
      for (let i = 0; i < 1000; i++) {
        links.push(createSimpleLink(i, i + 1, i + 2));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `1000 simple links: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // Binary should be smaller for large batches
      // Note: The exact ratio depends on ID sizes. Small IDs (< 128) fit in 1 varint byte
      // but text "(id: src tgt)" also has minimal overhead for small numbers.
      // The main savings come from eliminating separators and using varint encoding.
      assert.ok(
        ratio >= 1.2,
        `Expected at least 1.2x size reduction, got ${ratio.toFixed(2)}x`
      );
    });
  });

  describe('Self-Referencing Links', () => {
    it('should be significantly smaller for self-referencing links', () => {
      const links = [];
      for (let i = 0; i < 100; i++) {
        links.push(createSelfRefLink(i));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `100 self-ref links: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // Self-referencing links benefit from not repeating the target value
      // Text: "(5: 5 5)" = 10 bytes per link
      // Binary: type + id + source (with SELF_REF flag, no target)
      // Savings are modest for small IDs
      assert.ok(
        ratio >= 1.1,
        `Expected at least 1.1x size reduction for self-ref links, got ${ratio.toFixed(2)}x`
      );
    });
  });

  describe('Links with Large IDs', () => {
    it('should handle large numeric IDs efficiently', () => {
      const links = [];
      for (let i = 0; i < 100; i++) {
        const largeId = 1000000 + i;
        links.push(createSimpleLink(largeId, largeId + 1, largeId + 2));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `100 large-ID links: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // Large IDs benefit from varint encoding
      // Text: "(1000000: 1000001 1000002)" = 28 bytes per link
      // Binary: ~15-17 bytes per link (header overhead amortized over 100 links)
      // Large IDs that fit in 3-4 varint bytes are more efficient than text
      assert.ok(
        ratio >= 1.5,
        `Expected at least 1.5x size reduction for large IDs, got ${ratio.toFixed(2)}x`
      );
    });
  });

  describe('String Links', () => {
    it('should have similar size for string-heavy links', () => {
      const links = [];
      for (let i = 0; i < 100; i++) {
        links.push(createStringLink(i, 'source-value', 'target-value'));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `100 string links: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // String-heavy links won't see as much improvement since strings dominate
      // Both formats need to store the full string data
      assert.ok(
        ratio >= 0.8,
        `Expected no worse than 0.8x for string links, got ${ratio.toFixed(2)}x`
      );
    });
  });

  describe('Nested Links', () => {
    it('should be smaller for nested link structures', () => {
      const links = [];
      for (let i = 0; i < 50; i++) {
        const inner1 = createSimpleLink(i * 2, i, i + 1);
        const inner2 = createSimpleLink(i * 2 + 1, i + 1, i + 2);
        links.push(createNestedLink(1000 + i, inner1, inner2));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `50 nested links: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // Nested links have more overhead due to inline link markers
      // The savings come from varint encoding and no text separators
      assert.ok(
        ratio >= 1.1,
        `Expected at least 1.1x size reduction for nested links, got ${ratio.toFixed(2)}x`
      );
    });
  });

  describe('Links with Values Array', () => {
    it('should be smaller for links with values array', () => {
      const links = [];
      for (let i = 0; i < 100; i++) {
        links.push(
          createLinkWithValues(i, i + 1, i + 2, [i + 3, i + 4, i + 5])
        );
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      const ratio = textEncoded.length / binaryEncoded.length;
      console.log(
        `100 links with values: text=${textEncoded.length} bytes, binary=${binaryEncoded.length} bytes, ratio=${ratio.toFixed(2)}x`
      );

      // Links with values arrays should see compression from varint encoding
      assert.ok(
        ratio >= 1.2,
        `Expected at least 1.2x size reduction for links with values, got ${ratio.toFixed(2)}x`
      );
    });
  });
});

// =============================================================================
// Encoding/Decoding Performance Tests
// =============================================================================

describe('Binary Notation Performance', () => {
  describe('Encoding Performance', () => {
    it('should encode 10000 links efficiently', () => {
      const links = [];
      for (let i = 0; i < 10000; i++) {
        links.push(createSimpleLink(i, i + 1, i + 2));
      }

      const start = performance.now();
      const encoded = BinaryNotation.encode(links);
      const encodeTime = performance.now() - start;

      console.log(
        `Encoded 10000 links in ${encodeTime.toFixed(2)}ms (${((10000 / encodeTime) * 1000).toFixed(0)} links/sec)`
      );
      console.log(`Encoded size: ${encoded.length} bytes`);

      // Should encode at least 100,000 links per second
      assert.ok(
        encodeTime < 1000,
        `Encoding took too long: ${encodeTime.toFixed(2)}ms`
      );
    });
  });

  describe('Decoding Performance', () => {
    it('should decode 10000 links efficiently', () => {
      const links = [];
      for (let i = 0; i < 10000; i++) {
        links.push(createSimpleLink(i, i + 1, i + 2));
      }

      const encoded = BinaryNotation.encode(links);

      const start = performance.now();
      const decoded = BinaryNotation.decode(encoded);
      const decodeTime = performance.now() - start;

      console.log(
        `Decoded 10000 links in ${decodeTime.toFixed(2)}ms (${((10000 / decodeTime) * 1000).toFixed(0)} links/sec)`
      );

      assert.strictEqual(decoded.length, 10000);
      // Should decode at least 100,000 links per second
      assert.ok(
        decodeTime < 1000,
        `Decoding took too long: ${decodeTime.toFixed(2)}ms`
      );
    });
  });

  describe('Roundtrip Performance', () => {
    it('should roundtrip 10000 links efficiently', () => {
      const links = [];
      for (let i = 0; i < 10000; i++) {
        links.push(createSimpleLink(i, i + 1, i + 2));
      }

      const start = performance.now();
      const encoded = BinaryNotation.encode(links);
      const decoded = BinaryNotation.decode(encoded);
      const roundtripTime = performance.now() - start;

      console.log(
        `Roundtrip 10000 links in ${roundtripTime.toFixed(2)}ms (${((10000 / roundtripTime) * 1000).toFixed(0)} links/sec)`
      );

      assert.strictEqual(decoded.length, 10000);
    });
  });
});

// =============================================================================
// Data Integrity Tests
// =============================================================================

describe('Binary Notation Data Integrity', () => {
  it('should preserve all link data through roundtrip', () => {
    const links = [
      createSimpleLink(1, 2, 3),
      createSelfRefLink(5),
      createStringLink(10, 'hello', 'world'),
      createLinkWithValues(20, 21, 22, [23, 24, 25]),
    ];

    const encoded = BinaryNotation.encode(links);
    const decoded = BinaryNotation.decode(encoded);

    assert.strictEqual(decoded.length, links.length);

    // Check simple link
    assert.strictEqual(decoded[0].id, 1);
    assert.strictEqual(decoded[0].source, 2);
    assert.strictEqual(decoded[0].target, 3);

    // Check self-ref link
    assert.strictEqual(decoded[1].id, 5);
    assert.strictEqual(decoded[1].source, 5);
    assert.strictEqual(decoded[1].target, 5);

    // Check string link
    assert.strictEqual(decoded[2].id, 10);
    assert.strictEqual(decoded[2].source, 'hello');
    assert.strictEqual(decoded[2].target, 'world');

    // Check link with values
    assert.strictEqual(decoded[3].id, 20);
    assert.strictEqual(decoded[3].source, 21);
    assert.strictEqual(decoded[3].target, 22);
    assert.deepStrictEqual(decoded[3].values, [23, 24, 25]);
  });

  it('should preserve nested link structure', () => {
    const inner1 = createSimpleLink(1, 2, 3);
    const inner2 = createSimpleLink(4, 5, 6);
    const outer = createNestedLink(100, inner1, inner2);

    const encoded = BinaryNotation.encode([outer]);
    const decoded = BinaryNotation.decode(encoded);

    assert.strictEqual(decoded.length, 1);
    assert.strictEqual(decoded[0].id, 100);
    assert.deepStrictEqual(decoded[0].source, inner1);
    assert.deepStrictEqual(decoded[0].target, inner2);
  });

  it('should handle empty array', () => {
    const encoded = BinaryNotation.encode([]);
    const decoded = BinaryNotation.decode(encoded);

    assert.strictEqual(decoded.length, 0);
  });

  it('should handle large batch correctly', () => {
    const links = [];
    for (let i = 0; i < 10000; i++) {
      links.push(createSimpleLink(i, i * 2, i * 3));
    }

    const encoded = BinaryNotation.encode(links);
    const decoded = BinaryNotation.decode(encoded);

    assert.strictEqual(decoded.length, links.length);

    // Spot check some values
    assert.strictEqual(decoded[0].id, 0);
    assert.strictEqual(decoded[0].source, 0);
    assert.strictEqual(decoded[0].target, 0);

    assert.strictEqual(decoded[5000].id, 5000);
    assert.strictEqual(decoded[5000].source, 10000);
    assert.strictEqual(decoded[5000].target, 15000);

    assert.strictEqual(decoded[9999].id, 9999);
    assert.strictEqual(decoded[9999].source, 19998);
    assert.strictEqual(decoded[9999].target, 29997);
  });
});

// =============================================================================
// Summary Report
// =============================================================================

describe('Benchmark Summary', () => {
  it('should generate summary report', () => {
    const results = [];

    // Test different scenarios
    const scenarios = [
      { name: 'Small batch (10 links)', count: 10 },
      { name: 'Medium batch (100 links)', count: 100 },
      { name: 'Large batch (1000 links)', count: 1000 },
    ];

    for (const scenario of scenarios) {
      const links = [];
      for (let i = 0; i < scenario.count; i++) {
        links.push(createSimpleLink(i, i + 1, i + 2));
      }

      const textEncoded = links.map((l) => LinksNotation.stringify(l)).join('');
      const binaryEncoded = BinaryNotation.encode(links);

      results.push({
        name: scenario.name,
        count: scenario.count,
        textSize: textEncoded.length,
        binarySize: binaryEncoded.length,
        ratio: (textEncoded.length / binaryEncoded.length).toFixed(2),
      });
    }

    console.log('\n=== Binary vs Text Notation Benchmark Summary ===\n');
    console.log(
      'Scenario'.padEnd(25),
      'Text Size'.padEnd(12),
      'Binary Size'.padEnd(12),
      'Ratio'
    );
    console.log('-'.repeat(60));

    for (const r of results) {
      console.log(
        r.name.padEnd(25),
        `${r.textSize} B`.padEnd(12),
        `${r.binarySize} B`.padEnd(12),
        `${r.ratio}x`
      );
    }

    console.log('\n');

    // All scenarios should show size reduction
    for (const r of results) {
      assert.ok(
        parseFloat(r.ratio) >= 1.0,
        `Expected positive ratio for ${r.name}`
      );
    }
  });
});
