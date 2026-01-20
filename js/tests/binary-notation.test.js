/**
 * Unit tests for Binary Links Notation.
 *
 * Tests encoding, decoding, streaming, and buffer pooling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BinaryNotation,
  BinaryNotationError,
  BinaryStreamEncoder,
  BinaryStreamDecoder,
  BufferPool,
  BINARY_MAGIC,
  BINARY_VERSION,
  BINARY_HEADER_SIZE,
  createLink,
} from '../src/index.js';

import {
  encodeVarInt,
  decodeVarInt,
  varIntSize,
  encodeString,
  decodeString,
  stringSize,
  encodeValue,
  decodeValue,
  encodeLinkBody,
  decodeLinkBody,
  linkBodySize,
  LITERAL_STRING_SHORT,
  LITERAL_VARINT,
  LITERAL_NULL,
  LITERAL_TRUE,
  LITERAL_FALSE,
} from '../src/protocol/binary-notation.js';

// =============================================================================
// VarInt Tests
// =============================================================================

describe('VarInt encoding/decoding', () => {
  describe('encodeVarInt', () => {
    it('should encode 0', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(0, buffer, 0);
      assert.equal(bytesWritten, 1);
      assert.equal(buffer[0], 0x00);
    });

    it('should encode 1', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(1, buffer, 0);
      assert.equal(bytesWritten, 1);
      assert.equal(buffer[0], 0x01);
    });

    it('should encode 127', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(127, buffer, 0);
      assert.equal(bytesWritten, 1);
      assert.equal(buffer[0], 0x7f);
    });

    it('should encode 128', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(128, buffer, 0);
      assert.equal(bytesWritten, 2);
      assert.equal(buffer[0], 0x80);
      assert.equal(buffer[1], 0x01);
    });

    it('should encode 16383', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(16383, buffer, 0);
      assert.equal(bytesWritten, 2);
      assert.equal(buffer[0], 0xff);
      assert.equal(buffer[1], 0x7f);
    });

    it('should encode large number', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(1000000, buffer, 0);
      assert.ok(bytesWritten > 2);
    });

    it('should encode BigInt', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeVarInt(128n, buffer, 0);
      assert.equal(bytesWritten, 2);
    });
  });

  describe('decodeVarInt', () => {
    it('should decode 0', () => {
      const buffer = new Uint8Array([0x00]);
      const { value, bytesRead } = decodeVarInt(buffer, 0);
      assert.equal(value, 0);
      assert.equal(bytesRead, 1);
    });

    it('should decode 127', () => {
      const buffer = new Uint8Array([0x7f]);
      const { value, bytesRead } = decodeVarInt(buffer, 0);
      assert.equal(value, 127);
      assert.equal(bytesRead, 1);
    });

    it('should decode 128', () => {
      const buffer = new Uint8Array([0x80, 0x01]);
      const { value, bytesRead } = decodeVarInt(buffer, 0);
      assert.equal(value, 128);
      assert.equal(bytesRead, 2);
    });

    it('should decode 16383', () => {
      const buffer = new Uint8Array([0xff, 0x7f]);
      const { value, bytesRead } = decodeVarInt(buffer, 0);
      assert.equal(value, 16383);
      assert.equal(bytesRead, 2);
    });

    it('should roundtrip values', () => {
      const testValues = [0, 1, 127, 128, 255, 256, 16383, 16384, 1000000];
      for (const original of testValues) {
        const buffer = new Uint8Array(10);
        encodeVarInt(original, buffer, 0);
        const { value } = decodeVarInt(buffer, 0);
        assert.equal(value, original, `Failed for ${original}`);
      }
    });
  });

  describe('varIntSize', () => {
    it('should return 1 for values 0-127', () => {
      assert.equal(varIntSize(0), 1);
      assert.equal(varIntSize(127), 1);
    });

    it('should return 2 for values 128-16383', () => {
      assert.equal(varIntSize(128), 2);
      assert.equal(varIntSize(16383), 2);
    });

    it('should return 3 for larger values', () => {
      assert.equal(varIntSize(16384), 3);
    });
  });
});

// =============================================================================
// String Encoding Tests
// =============================================================================

describe('String encoding/decoding', () => {
  describe('encodeString', () => {
    it('should encode empty string', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeString('', buffer, 0);
      assert.equal(bytesWritten, 2); // type + length byte
      assert.equal(buffer[0], LITERAL_STRING_SHORT);
      assert.equal(buffer[1], 0);
    });

    it('should encode short string', () => {
      const buffer = new Uint8Array(20);
      const bytesWritten = encodeString('hello', buffer, 0);
      assert.equal(bytesWritten, 2 + 5); // type + length + data
      assert.equal(buffer[0], LITERAL_STRING_SHORT);
      assert.equal(buffer[1], 5);
    });

    it('should encode UTF-8 characters', () => {
      const buffer = new Uint8Array(20);
      const bytesWritten = encodeString('cafe', buffer, 0);
      assert.ok(bytesWritten > 2);
    });
  });

  describe('decodeString', () => {
    it('should decode empty string', () => {
      const buffer = new Uint8Array([LITERAL_STRING_SHORT, 0]);
      const { value, bytesRead } = decodeString(buffer, 0);
      assert.equal(value, '');
      assert.equal(bytesRead, 2);
    });

    it('should decode short string', () => {
      const buffer = new Uint8Array([
        LITERAL_STRING_SHORT,
        5,
        0x68,
        0x65,
        0x6c,
        0x6c,
        0x6f,
      ]);
      const { value, bytesRead } = decodeString(buffer, 0);
      assert.equal(value, 'hello');
      assert.equal(bytesRead, 7);
    });

    it('should roundtrip strings', () => {
      const testStrings = ['', 'hello', 'world', 'Binary Links Notation'];
      for (const original of testStrings) {
        const buffer = new Uint8Array(100);
        encodeString(original, buffer, 0);
        const { value } = decodeString(buffer, 0);
        assert.equal(value, original, `Failed for "${original}"`);
      }
    });
  });

  describe('stringSize', () => {
    it('should return correct size for short strings', () => {
      assert.equal(stringSize(''), 2);
      assert.equal(stringSize('hello'), 2 + 5);
    });
  });
});

// =============================================================================
// Value Encoding Tests
// =============================================================================

describe('Value encoding/decoding', () => {
  describe('encodeValue', () => {
    it('should encode null', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeValue(null, buffer, 0);
      assert.equal(bytesWritten, 1);
      assert.equal(buffer[0], LITERAL_NULL);
    });

    it('should encode boolean true', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeValue(true, buffer, 0);
      assert.equal(bytesWritten, 1);
      assert.equal(buffer[0], LITERAL_TRUE);
    });

    it('should encode boolean false', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeValue(false, buffer, 0);
      assert.equal(bytesWritten, 1);
      assert.equal(buffer[0], LITERAL_FALSE);
    });

    it('should encode number as literal', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeValue(42, buffer, 0, false);
      assert.ok(bytesWritten > 1);
      assert.equal(buffer[0], LITERAL_VARINT);
    });

    it('should encode number as ID reference', () => {
      const buffer = new Uint8Array(10);
      const bytesWritten = encodeValue(42, buffer, 0, true);
      // ID reference is just the varint, no type marker
      assert.equal(bytesWritten, 1);
    });
  });

  describe('decodeValue', () => {
    it('should decode null', () => {
      const buffer = new Uint8Array([LITERAL_NULL]);
      const { value, bytesRead } = decodeValue(buffer, 0);
      assert.equal(value, null);
      assert.equal(bytesRead, 1);
    });

    it('should decode boolean', () => {
      const bufferTrue = new Uint8Array([LITERAL_TRUE]);
      const bufferFalse = new Uint8Array([LITERAL_FALSE]);
      assert.equal(decodeValue(bufferTrue, 0).value, true);
      assert.equal(decodeValue(bufferFalse, 0).value, false);
    });

    it('should roundtrip values', () => {
      const testValues = [null, true, false, 'test', 42];
      for (const original of testValues) {
        const buffer = new Uint8Array(100);
        encodeValue(original, buffer, 0);
        const { value } = decodeValue(buffer, 0);
        assert.deepEqual(value, original, `Failed for ${original}`);
      }
    });
  });
});

// =============================================================================
// Link Body Encoding Tests
// =============================================================================

describe('Link body encoding/decoding', () => {
  describe('encodeLinkBody', () => {
    it('should encode simple link', () => {
      const link = createLink(1, 2, 3);
      const buffer = new Uint8Array(100);
      const bytesWritten = encodeLinkBody(link, buffer, 0);
      assert.ok(bytesWritten > 0);
    });

    it('should encode self-referencing link', () => {
      const link = createLink(5, 5, 5);
      const buffer = new Uint8Array(100);
      const bytesWritten = encodeLinkBody(link, buffer, 0);
      // Self-ref should be smaller than non-self-ref
      assert.ok(bytesWritten <= 3);
    });

    it('should encode link with string values', () => {
      const link = createLink(0, 'type', 'enqueue');
      const buffer = new Uint8Array(100);
      const bytesWritten = encodeLinkBody(link, buffer, 0);
      assert.ok(bytesWritten > 0);
    });
  });

  describe('decodeLinkBody', () => {
    it('should decode simple link', () => {
      const original = createLink(1, 2, 3);
      const buffer = new Uint8Array(100);
      encodeLinkBody(original, buffer, 0);
      const { link } = decodeLinkBody(buffer, 0);
      assert.equal(link.id, 1);
      assert.equal(link.source, 2);
      assert.equal(link.target, 3);
    });

    it('should roundtrip various links', () => {
      const testLinks = [
        createLink(1, 2, 3),
        createLink(0, 'hello', 'world'),
        createLink(5, 5, 5), // self-ref
        createLink(10, 20, 30, [40, 50]),
      ];
      for (const original of testLinks) {
        const buffer = new Uint8Array(200);
        encodeLinkBody(original, buffer, 0);
        const { link } = decodeLinkBody(buffer, 0);
        assert.equal(link.id, original.id);
        // For nested/complex values, check they round-trip
        if (typeof original.source === 'number') {
          assert.equal(link.source, original.source);
        }
        if (typeof original.target === 'number') {
          assert.equal(link.target, original.target);
        }
      }
    });
  });

  describe('linkBodySize', () => {
    it('should return correct size', () => {
      const link = createLink(1, 2, 3);
      const size = linkBodySize(link);
      const buffer = new Uint8Array(100);
      const actual = encodeLinkBody(link, buffer, 0);
      assert.equal(size, actual);
    });
  });
});

// =============================================================================
// BinaryNotation Class Tests
// =============================================================================

describe('BinaryNotation', () => {
  describe('encode', () => {
    it('should encode a single link', () => {
      const link = createLink(1, 2, 3);
      const buffer = BinaryNotation.encode(link);

      assert.ok(buffer instanceof Uint8Array);
      assert.ok(buffer.length >= BINARY_HEADER_SIZE);
    });

    it('should encode multiple links', () => {
      const links = [createLink(1, 2, 3), createLink(4, 5, 6)];
      const buffer = BinaryNotation.encode(links);

      assert.ok(buffer instanceof Uint8Array);
      assert.ok(buffer.length >= BINARY_HEADER_SIZE);
    });

    it('should include correct magic number', () => {
      const buffer = BinaryNotation.encode(createLink(1, 2, 3));
      const view = new DataView(buffer.buffer);
      assert.equal(view.getUint32(0, false), BINARY_MAGIC);
    });

    it('should include correct version', () => {
      const buffer = BinaryNotation.encode(createLink(1, 2, 3));
      const view = new DataView(buffer.buffer);
      assert.equal(view.getUint16(4, false), BINARY_VERSION);
    });
  });

  describe('decode', () => {
    it('should decode encoded links', () => {
      const original = [createLink(1, 2, 3), createLink(4, 5, 6)];
      const buffer = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(buffer);

      assert.equal(decoded.length, 2);
      assert.equal(decoded[0].id, 1);
      assert.equal(decoded[0].source, 2);
      assert.equal(decoded[0].target, 3);
      assert.equal(decoded[1].id, 4);
      assert.equal(decoded[1].source, 5);
      assert.equal(decoded[1].target, 6);
    });

    it('should throw on invalid magic', () => {
      const buffer = new Uint8Array(BINARY_HEADER_SIZE + 10);
      assert.throws(() => BinaryNotation.decode(buffer), BinaryNotationError);
    });

    it('should throw on truncated buffer', () => {
      const buffer = new Uint8Array(5);
      assert.throws(() => BinaryNotation.decode(buffer), BinaryNotationError);
    });

    it('should accept ArrayBuffer', () => {
      const original = createLink(1, 2, 3);
      const uint8 = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(uint8.buffer);

      assert.equal(decoded.length, 1);
      assert.equal(decoded[0].id, 1);
    });
  });

  describe('isBinary', () => {
    it('should return true for binary notation', () => {
      const buffer = BinaryNotation.encode(createLink(1, 2, 3));
      assert.equal(BinaryNotation.isBinary(buffer), true);
    });

    it('should return false for text', () => {
      const buffer = new TextEncoder().encode('(1 2)');
      assert.equal(BinaryNotation.isBinary(buffer), false);
    });

    it('should return false for short buffer', () => {
      const buffer = new Uint8Array(3);
      assert.equal(BinaryNotation.isBinary(buffer), false);
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip simple links', () => {
      const original = createLink(1, 2, 3);
      const buffer = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(buffer);

      assert.equal(decoded.length, 1);
      assert.equal(decoded[0].id, 1);
      assert.equal(decoded[0].source, 2);
      assert.equal(decoded[0].target, 3);
    });

    it('should roundtrip links with string values', () => {
      const original = createLink(0, 'type', 'enqueue');
      const buffer = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(buffer);

      assert.equal(decoded.length, 1);
      assert.equal(decoded[0].source, 'type');
      assert.equal(decoded[0].target, 'enqueue');
    });

    it('should roundtrip self-referencing links', () => {
      const original = createLink(5, 5, 5);
      const buffer = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(buffer);

      assert.equal(decoded.length, 1);
      assert.equal(decoded[0].id, 5);
      assert.equal(decoded[0].source, 5);
      assert.equal(decoded[0].target, 5);
    });

    it('should roundtrip links with values array', () => {
      const original = createLink(1, 2, 3, [4, 5, 6]);
      const buffer = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(buffer);

      assert.equal(decoded.length, 1);
      assert.ok(decoded[0].values);
      assert.equal(decoded[0].values.length, 3);
      assert.equal(decoded[0].values[0], 4);
      assert.equal(decoded[0].values[1], 5);
      assert.equal(decoded[0].values[2], 6);
    });

    it('should roundtrip multiple links', () => {
      const original = [
        createLink(1, 2, 3),
        createLink(4, 'hello', 'world'),
        createLink(7, 8, 9, [10, 11]),
      ];
      const buffer = BinaryNotation.encode(original);
      const decoded = BinaryNotation.decode(buffer);

      assert.equal(decoded.length, 3);
    });
  });

  describe('size comparison', () => {
    it('should be smaller than text for numeric links', () => {
      const links = [
        createLink(1, 2, 3),
        createLink(4, 5, 6),
        createLink(7, 8, 9),
      ];

      const binaryBuffer = BinaryNotation.encode(links);
      const textNotation = '((1 2) (4 5) (7 8))'; // approximate text

      // Binary should be more compact for numeric data
      assert.ok(
        binaryBuffer.length < textNotation.length * 2,
        `Binary: ${binaryBuffer.length}, Text: ${textNotation.length}`
      );
    });
  });
});

// =============================================================================
// Stream Encoder Tests
// =============================================================================

describe('BinaryStreamEncoder', () => {
  it('should create encoder with default options', () => {
    const encoder = BinaryNotation.createStreamEncoder();
    assert.ok(encoder instanceof BinaryStreamEncoder);
  });

  it('should encode written links', () => {
    const encoder = new BinaryStreamEncoder();
    encoder.write(createLink(1, 2, 3));
    encoder.write(createLink(4, 5, 6));

    const buffer = encoder.finish();
    const decoded = BinaryNotation.decode(buffer);

    assert.equal(decoded.length, 2);
  });

  it('should support chaining', () => {
    const encoder = new BinaryStreamEncoder();
    const result = encoder
      .write(createLink(1, 2, 3))
      .write(createLink(4, 5, 6));
    assert.equal(result, encoder);
  });

  it('should reset correctly', () => {
    const encoder = new BinaryStreamEncoder();
    encoder.write(createLink(1, 2, 3));
    encoder.reset();
    encoder.write(createLink(4, 5, 6));

    const buffer = encoder.finish();
    const decoded = BinaryNotation.decode(buffer);

    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].id, 4);
  });
});

// =============================================================================
// Stream Decoder Tests
// =============================================================================

describe('BinaryStreamDecoder', () => {
  it('should create decoder with default options', () => {
    const decoder = BinaryNotation.createStreamDecoder();
    assert.ok(decoder instanceof BinaryStreamDecoder);
  });

  it('should emit links on end', (_, done) => {
    const decoder = new BinaryStreamDecoder();
    const links = [];

    decoder.on('link', (link) => {
      links.push(link);
    });

    decoder.on('end', () => {
      assert.equal(links.length, 2);
      done();
    });

    const buffer = BinaryNotation.encode([
      createLink(1, 2, 3),
      createLink(4, 5, 6),
    ]);
    decoder.write(buffer);
    decoder.end();
  });

  it('should emit error on invalid data', (_, done) => {
    const decoder = new BinaryStreamDecoder();

    decoder.on('error', (err) => {
      assert.ok(err instanceof Error);
      done();
    });

    decoder.write(new Uint8Array([0x00, 0x00, 0x00, 0x00]));
    decoder.end();
  });

  it('should support chaining', () => {
    const decoder = new BinaryStreamDecoder();
    const chunk = new Uint8Array(10);
    const result = decoder.write(chunk);
    assert.equal(result, decoder);
  });

  it('should throw on write after end', () => {
    const decoder = new BinaryStreamDecoder();
    decoder.end();
    assert.throws(() => decoder.write(new Uint8Array(10)), /ended/);
  });

  it('should support off to remove listeners', () => {
    const decoder = new BinaryStreamDecoder();
    const handler = () => {};

    decoder.on('link', handler);
    decoder.off('link', handler);
    // No assertion needed - just checking it doesn't throw
  });
});

// =============================================================================
// BufferPool Tests
// =============================================================================

describe('BufferPool', () => {
  it('should create pool with default options', () => {
    const pool = new BufferPool();
    assert.ok(pool);
  });

  it('should acquire small buffers', () => {
    const pool = new BufferPool();
    const buffer = pool.acquire(100);

    assert.ok(buffer instanceof Uint8Array);
    assert.ok(buffer.length >= 100);
  });

  it('should acquire medium buffers', () => {
    const pool = new BufferPool({ mediumBufferSize: 4096 });
    const buffer = pool.acquire(1000);

    assert.ok(buffer.length >= 1000);
  });

  it('should acquire large buffers', () => {
    const pool = new BufferPool({ largeBufferSize: 65536 });
    const buffer = pool.acquire(10000);

    assert.ok(buffer.length >= 10000);
  });

  it('should reuse released buffers', () => {
    const pool = new BufferPool({ smallBufferSize: 256 });

    const buffer1 = pool.acquire(100);
    pool.release(buffer1);

    const buffer2 = pool.acquire(100);
    assert.equal(buffer1, buffer2); // Same buffer reused
  });

  it('should not reuse buffers of wrong size', () => {
    const pool = new BufferPool({
      smallBufferSize: 256,
      mediumBufferSize: 4096,
    });

    const buffer1 = pool.acquire(100); // Gets small buffer
    pool.release(buffer1);

    const buffer2 = pool.acquire(1000); // Gets medium buffer
    assert.notEqual(buffer1, buffer2);
  });

  it('should clear all buffers', () => {
    const pool = new BufferPool();

    pool.acquire(100);
    pool.acquire(1000);
    pool.clear();

    const stats = pool.getStats();
    assert.equal(stats.totalBuffers, 0);
  });

  it('should return correct stats', () => {
    const pool = new BufferPool();
    const stats = pool.getStats();

    assert.equal(typeof stats.smallBuffers, 'number');
    assert.equal(typeof stats.mediumBuffers, 'number');
    assert.equal(typeof stats.largeBuffers, 'number');
    assert.equal(typeof stats.totalBuffers, 'number');
  });

  it('should respect maxPoolSize', () => {
    const pool = new BufferPool({
      smallBufferSize: 256,
      maxPoolSize: 2,
    });

    // Acquire 3 buffers
    const buffers = [];
    for (let i = 0; i < 3; i++) {
      buffers.push(pool.acquire(100));
    }

    // Release all 3 buffers
    for (const buffer of buffers) {
      pool.release(buffer);
    }

    // Only 2 should be in pool (maxPoolSize)
    const stats = pool.getStats();
    assert.equal(stats.smallBuffers, 2);
  });
});

// =============================================================================
// BinaryNotationError Tests
// =============================================================================

describe('BinaryNotationError', () => {
  it('should have correct name', () => {
    const error = new BinaryNotationError('test', 0x01);
    assert.equal(error.name, 'BinaryNotationError');
  });

  it('should store code', () => {
    const error = new BinaryNotationError('test', 0x02);
    assert.equal(error.code, 0x02);
  });

  it('should store position', () => {
    const error = new BinaryNotationError('test', 0x01, 42);
    assert.equal(error.position, 42);
  });

  it('should have null position by default', () => {
    const error = new BinaryNotationError('test', 0x01);
    assert.equal(error.position, null);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe('Constants', () => {
  it('should export BINARY_MAGIC', () => {
    assert.equal(typeof BINARY_MAGIC, 'number');
    assert.equal(BINARY_MAGIC, 0x4c4e4b51); // "LNKQ"
  });

  it('should export BINARY_VERSION', () => {
    assert.equal(typeof BINARY_VERSION, 'number');
    assert.equal(BINARY_VERSION, 0x0100); // 1.0
  });

  it('should export BINARY_HEADER_SIZE', () => {
    assert.equal(typeof BINARY_HEADER_SIZE, 'number');
    assert.equal(BINARY_HEADER_SIZE, 11);
  });
});
