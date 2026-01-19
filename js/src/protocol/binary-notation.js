/**
 * Binary Links Notation encoder/decoder.
 *
 * Provides high-performance binary encoding/decoding for Links,
 * achieving 5-10x smaller message sizes compared to text notation.
 *
 * @module protocol/binary-notation
 * @see https://github.com/link-foundation/links-queue/docs/BINARY-NOTATION-SPEC.md
 */

import { createLink, isLink, getLinkId } from '../index.js';

// =============================================================================
// Constants
// =============================================================================

/** Magic number for protocol identification: "LNKQ" */
export const MAGIC = 0x4c4e4b51;

/** Current protocol version (1.0) */
export const VERSION = 0x0100;

/** Header size in bytes */
export const HEADER_SIZE = 11;

// Flag bits
export const FLAG_COMPRESSED = 0x01;
export const FLAG_COMPRESSION_MASK = 0x06;
export const FLAG_COMPRESSION_ZSTD = 0x02;
export const FLAG_COMPRESSION_LZ4 = 0x04;
export const FLAG_HAS_CHECKSUM = 0x08;
export const FLAG_STREAMING = 0x10;

// Link type bits
export const TYPE_SOURCE_IS_ID = 0x01;
export const TYPE_TARGET_IS_ID = 0x02;
export const TYPE_SELF_REF = 0x04;
export const TYPE_HAS_ID = 0x08;
export const TYPE_HAS_VALUES = 0x10;
export const TYPE_ID_SIZE_MASK = 0x60;
export const TYPE_ID_SIZE_VARINT = 0x00;
export const TYPE_ID_SIZE_4BYTES = 0x20;
export const TYPE_ID_SIZE_8BYTES = 0x40;

// Literal type markers
export const LITERAL_NULL = 0x00;
export const LITERAL_FALSE = 0x01;
export const LITERAL_TRUE = 0x02;
export const LITERAL_VARINT = 0x10;
export const LITERAL_INT32 = 0x11;
export const LITERAL_INT64 = 0x12;
export const LITERAL_FLOAT64 = 0x13;
export const LITERAL_STRING_SHORT = 0x20;
export const LITERAL_STRING_MEDIUM = 0x21;
export const LITERAL_STRING_LONG = 0x22;
export const LITERAL_BINARY_SHORT = 0x30;
export const LITERAL_BINARY_MEDIUM = 0x31;
export const LITERAL_BINARY_LONG = 0x32;
export const LITERAL_LINK = 0x40;

// Error codes
export const ERROR_INVALID_MAGIC = 0x01;
export const ERROR_UNSUPPORTED_VERSION = 0x02;
export const ERROR_INVALID_FLAGS = 0x03;
export const ERROR_TRUNCATED_MESSAGE = 0x04;
export const ERROR_INVALID_TYPE = 0x05;
export const ERROR_INVALID_LITERAL = 0x06;
export const ERROR_DECOMPRESSION_FAILED = 0x07;
export const ERROR_CHECKSUM_MISMATCH = 0x08;

// =============================================================================
// BinaryNotationError
// =============================================================================

/**
 * Error thrown when binary notation encoding/decoding fails.
 */
export class BinaryNotationError extends Error {
  /**
   * Creates a new BinaryNotationError.
   *
   * @param {string} message - Error message
   * @param {number} code - Error code
   * @param {number} [position] - Position in buffer where error occurred
   */
  constructor(message, code, position = null) {
    super(message);
    this.name = 'BinaryNotationError';
    this.code = code;
    this.position = position;
  }
}

// =============================================================================
// VarInt Encoding/Decoding (LEB128)
// =============================================================================

/**
 * Encodes a number as a variable-length integer (LEB128).
 *
 * @param {number|bigint} value - The value to encode
 * @param {Uint8Array} buffer - Buffer to write to
 * @param {number} offset - Offset in buffer
 * @returns {number} Number of bytes written
 */
export function encodeVarInt(value, buffer, offset) {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  let bytesWritten = 0;

  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) {
      byte |= 0x80;
    }
    buffer[offset + bytesWritten] = byte;
    bytesWritten++;
  } while (v !== 0n);

  return bytesWritten;
}

/**
 * Decodes a variable-length integer (LEB128).
 *
 * @param {Uint8Array} buffer - Buffer to read from
 * @param {number} offset - Offset in buffer
 * @returns {{value: number|bigint, bytesRead: number}} Decoded value and bytes read
 */
export function decodeVarInt(buffer, offset) {
  let result = 0n;
  let shift = 0n;
  let bytesRead = 0;

  while (true) {
    if (offset + bytesRead >= buffer.length) {
      throw new BinaryNotationError(
        'Unexpected end of buffer while reading varint',
        ERROR_TRUNCATED_MESSAGE,
        offset + bytesRead
      );
    }

    const byte = buffer[offset + bytesRead];
    bytesRead++;
    result |= BigInt(byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7n;

    if (shift > 63n) {
      throw new BinaryNotationError(
        'VarInt too large',
        ERROR_INVALID_LITERAL,
        offset
      );
    }
  }

  // Convert to number if small enough
  const value =
    result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result;
  return { value, bytesRead };
}

/**
 * Gets the number of bytes needed to encode a value as varint.
 *
 * @param {number|bigint} value - The value to measure
 * @returns {number} Number of bytes needed
 */
export function varIntSize(value) {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  let size = 0;
  do {
    v >>= 7n;
    size++;
  } while (v !== 0n);
  return size;
}

// =============================================================================
// String Encoding/Decoding
// =============================================================================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encodes a string to the buffer.
 *
 * @param {string} str - String to encode
 * @param {Uint8Array} buffer - Buffer to write to
 * @param {number} offset - Offset in buffer
 * @returns {number} Number of bytes written
 */
export function encodeString(str, buffer, offset) {
  const encoded = textEncoder.encode(str);
  const len = encoded.length;
  let bytesWritten = 0;

  if (len <= 255) {
    buffer[offset] = LITERAL_STRING_SHORT;
    buffer[offset + 1] = len;
    bytesWritten = 2;
  } else if (len <= 65535) {
    buffer[offset] = LITERAL_STRING_MEDIUM;
    buffer[offset + 1] = (len >> 8) & 0xff;
    buffer[offset + 2] = len & 0xff;
    bytesWritten = 3;
  } else {
    buffer[offset] = LITERAL_STRING_LONG;
    buffer[offset + 1] = (len >> 24) & 0xff;
    buffer[offset + 2] = (len >> 16) & 0xff;
    buffer[offset + 3] = (len >> 8) & 0xff;
    buffer[offset + 4] = len & 0xff;
    bytesWritten = 5;
  }

  buffer.set(encoded, offset + bytesWritten);
  return bytesWritten + len;
}

/**
 * Decodes a string from the buffer.
 *
 * @param {Uint8Array} buffer - Buffer to read from
 * @param {number} offset - Offset in buffer
 * @returns {{value: string, bytesRead: number}} Decoded string and bytes read
 */
export function decodeString(buffer, offset) {
  const type = buffer[offset];
  let len;
  let headerSize;

  if (type === LITERAL_STRING_SHORT) {
    len = buffer[offset + 1];
    headerSize = 2;
  } else if (type === LITERAL_STRING_MEDIUM) {
    len = (buffer[offset + 1] << 8) | buffer[offset + 2];
    headerSize = 3;
  } else if (type === LITERAL_STRING_LONG) {
    len =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];
    headerSize = 5;
  } else {
    throw new BinaryNotationError(
      `Invalid string type: 0x${type.toString(16)}`,
      ERROR_INVALID_LITERAL,
      offset
    );
  }

  const value = textDecoder.decode(
    buffer.subarray(offset + headerSize, offset + headerSize + len)
  );
  return { value, bytesRead: headerSize + len };
}

/**
 * Gets the number of bytes needed to encode a string.
 *
 * @param {string} str - String to measure
 * @returns {number} Number of bytes needed
 */
export function stringSize(str) {
  const len = textEncoder.encode(str).length;
  if (len <= 255) {
    return 2 + len;
  }
  if (len <= 65535) {
    return 3 + len;
  }
  return 5 + len;
}

// =============================================================================
// Value Encoding/Decoding
// =============================================================================

/**
 * Encodes a value (link reference or literal) to the buffer.
 *
 * @param {*} value - Value to encode
 * @param {Uint8Array} buffer - Buffer to write to
 * @param {number} offset - Offset in buffer
 * @param {boolean} [asId=false] - If true, encode as link ID reference
 * @returns {number} Number of bytes written
 */
export function encodeValue(value, buffer, offset, asId = false) {
  // Null
  if (value === null || value === undefined) {
    buffer[offset] = LITERAL_NULL;
    return 1;
  }

  // Boolean
  if (typeof value === 'boolean') {
    buffer[offset] = value ? LITERAL_TRUE : LITERAL_FALSE;
    return 1;
  }

  // Number - encode as ID reference or literal
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (asId) {
      // Encode as varint ID reference
      return encodeVarInt(value, buffer, offset);
    }
    // Encode as literal
    buffer[offset] = LITERAL_VARINT;
    return 1 + encodeVarInt(value, buffer, offset + 1);
  }

  // String
  if (typeof value === 'string') {
    return encodeString(value, buffer, offset);
  }

  // Link
  if (isLink(value)) {
    buffer[offset] = LITERAL_LINK;
    return 1 + encodeLinkBody(value, buffer, offset + 1);
  }

  // Fallback: convert to string
  return encodeString(String(value), buffer, offset);
}

/**
 * Decodes a value from the buffer.
 *
 * @param {Uint8Array} buffer - Buffer to read from
 * @param {number} offset - Offset in buffer
 * @param {boolean} [asId=false] - If true, decode as link ID reference
 * @returns {{value: *, bytesRead: number}} Decoded value and bytes read
 */
export function decodeValue(buffer, offset, asId = false) {
  if (asId) {
    // Decode as varint ID reference
    return decodeVarInt(buffer, offset);
  }

  const type = buffer[offset];

  // Null
  if (type === LITERAL_NULL) {
    return { value: null, bytesRead: 1 };
  }

  // Boolean
  if (type === LITERAL_FALSE) {
    return { value: false, bytesRead: 1 };
  }
  if (type === LITERAL_TRUE) {
    return { value: true, bytesRead: 1 };
  }

  // VarInt
  if (type === LITERAL_VARINT) {
    const { value, bytesRead } = decodeVarInt(buffer, offset + 1);
    return { value, bytesRead: 1 + bytesRead };
  }

  // Int32
  if (type === LITERAL_INT32) {
    const value =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];
    return { value, bytesRead: 5 };
  }

  // Int64
  if (type === LITERAL_INT64) {
    const high =
      (buffer[offset + 1] << 24) |
      (buffer[offset + 2] << 16) |
      (buffer[offset + 3] << 8) |
      buffer[offset + 4];
    const low =
      (buffer[offset + 5] << 24) |
      (buffer[offset + 6] << 16) |
      (buffer[offset + 7] << 8) |
      buffer[offset + 8];
    const value = (BigInt(high) << 32n) | BigInt(low >>> 0);
    return { value, bytesRead: 9 };
  }

  // Float64
  if (type === LITERAL_FLOAT64) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 8);
    const value = view.getFloat64(0, false);
    return { value, bytesRead: 9 };
  }

  // String
  if (
    type === LITERAL_STRING_SHORT ||
    type === LITERAL_STRING_MEDIUM ||
    type === LITERAL_STRING_LONG
  ) {
    return decodeString(buffer, offset);
  }

  // Binary (treat as Uint8Array)
  if (
    type === LITERAL_BINARY_SHORT ||
    type === LITERAL_BINARY_MEDIUM ||
    type === LITERAL_BINARY_LONG
  ) {
    let len;
    let headerSize;
    if (type === LITERAL_BINARY_SHORT) {
      len = buffer[offset + 1];
      headerSize = 2;
    } else if (type === LITERAL_BINARY_MEDIUM) {
      len = (buffer[offset + 1] << 8) | buffer[offset + 2];
      headerSize = 3;
    } else {
      len =
        (buffer[offset + 1] << 24) |
        (buffer[offset + 2] << 16) |
        (buffer[offset + 3] << 8) |
        buffer[offset + 4];
      headerSize = 5;
    }
    const value = buffer.slice(offset + headerSize, offset + headerSize + len);
    return { value, bytesRead: headerSize + len };
  }

  // Inline link
  if (type === LITERAL_LINK) {
    const { link, bytesRead } = decodeLinkBody(buffer, offset + 1);
    return { value: link, bytesRead: 1 + bytesRead };
  }

  throw new BinaryNotationError(
    `Unknown literal type: 0x${type.toString(16)}`,
    ERROR_INVALID_LITERAL,
    offset
  );
}

/**
 * Gets the number of bytes needed to encode a value.
 *
 * @param {*} value - Value to measure
 * @param {boolean} [asId=false] - If true, measure as link ID reference
 * @returns {number} Number of bytes needed
 */
export function valueSize(value, asId = false) {
  if (value === null || value === undefined) {
    return 1;
  }
  if (typeof value === 'boolean') {
    return 1;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    if (asId) {
      return varIntSize(value);
    }
    return 1 + varIntSize(value);
  }

  if (typeof value === 'string') {
    return stringSize(value);
  }
  if (isLink(value)) {
    return 1 + linkBodySize(value);
  }

  return stringSize(String(value));
}

// =============================================================================
// Link Body Encoding/Decoding
// =============================================================================

/**
 * Encodes a link body (without the LITERAL_LINK marker).
 *
 * @param {import('../index.d.ts').Link} link - Link to encode
 * @param {Uint8Array} buffer - Buffer to write to
 * @param {number} offset - Offset in buffer
 * @returns {number} Number of bytes written
 */
export function encodeLinkBody(link, buffer, offset) {
  const sourceId = getLinkId(link.source);
  const targetId = getLinkId(link.target);

  // Determine type flags
  let type = 0;

  const sourceIsId =
    typeof sourceId === 'number' || typeof sourceId === 'bigint';
  const targetIsId =
    typeof targetId === 'number' || typeof targetId === 'bigint';
  const isSelfRef = sourceId === targetId && sourceIsId && targetIsId;

  if (sourceIsId) {
    type |= TYPE_SOURCE_IS_ID;
  }
  if (targetIsId) {
    type |= TYPE_TARGET_IS_ID;
  }
  if (isSelfRef) {
    type |= TYPE_SELF_REF;
  }
  if (link.id !== undefined && link.id !== null) {
    type |= TYPE_HAS_ID;
  }
  if (link.values && link.values.length > 0) {
    type |= TYPE_HAS_VALUES;
  }

  buffer[offset] = type;
  let bytesWritten = 1;

  // Write ID if present
  if (type & TYPE_HAS_ID) {
    bytesWritten += encodeVarInt(link.id, buffer, offset + bytesWritten);
  }

  // Write source (or both for self-ref)
  if (isSelfRef) {
    bytesWritten += encodeValue(
      link.source,
      buffer,
      offset + bytesWritten,
      sourceIsId
    );
  } else {
    bytesWritten += encodeValue(
      link.source,
      buffer,
      offset + bytesWritten,
      sourceIsId
    );
    bytesWritten += encodeValue(
      link.target,
      buffer,
      offset + bytesWritten,
      targetIsId
    );
  }

  // Write values array if present
  if (type & TYPE_HAS_VALUES) {
    const values = link.values;
    bytesWritten += encodeVarInt(values.length, buffer, offset + bytesWritten);
    for (const val of values) {
      bytesWritten += encodeValue(val, buffer, offset + bytesWritten, false);
    }
  }

  return bytesWritten;
}

/**
 * Decodes a link body from the buffer.
 *
 * @param {Uint8Array} buffer - Buffer to read from
 * @param {number} offset - Offset in buffer
 * @returns {{link: import('../index.d.ts').Link, bytesRead: number}} Decoded link and bytes read
 */
export function decodeLinkBody(buffer, offset) {
  const type = buffer[offset];
  let bytesRead = 1;

  const sourceIsId = (type & TYPE_SOURCE_IS_ID) !== 0;
  const targetIsId = (type & TYPE_TARGET_IS_ID) !== 0;
  const isSelfRef = (type & TYPE_SELF_REF) !== 0;
  const hasId = (type & TYPE_HAS_ID) !== 0;
  const hasValues = (type & TYPE_HAS_VALUES) !== 0;

  // Read ID if present
  let id = 0;
  if (hasId) {
    const result = decodeVarInt(buffer, offset + bytesRead);
    id = result.value;
    bytesRead += result.bytesRead;
  }

  // Read source
  const sourceResult = decodeValue(buffer, offset + bytesRead, sourceIsId);
  const source = sourceResult.value;
  bytesRead += sourceResult.bytesRead;

  // Read target (or use source for self-ref)
  let target;
  if (isSelfRef) {
    target = source;
  } else {
    const targetResult = decodeValue(buffer, offset + bytesRead, targetIsId);
    target = targetResult.value;
    bytesRead += targetResult.bytesRead;
  }

  // Read values array if present
  let values;
  if (hasValues) {
    const countResult = decodeVarInt(buffer, offset + bytesRead);
    const count = countResult.value;
    bytesRead += countResult.bytesRead;

    values = [];
    for (let i = 0; i < count; i++) {
      const valResult = decodeValue(buffer, offset + bytesRead, false);
      values.push(valResult.value);
      bytesRead += valResult.bytesRead;
    }
  }

  const link = createLink(id, source, target, values);
  return { link, bytesRead };
}

/**
 * Gets the number of bytes needed to encode a link body.
 *
 * @param {import('../index.d.ts').Link} link - Link to measure
 * @returns {number} Number of bytes needed
 */
export function linkBodySize(link) {
  const sourceId = getLinkId(link.source);
  const targetId = getLinkId(link.target);

  const sourceIsId =
    typeof sourceId === 'number' || typeof sourceId === 'bigint';
  const targetIsId =
    typeof targetId === 'number' || typeof targetId === 'bigint';
  const isSelfRef = sourceId === targetId && sourceIsId && targetIsId;
  const hasId = link.id !== undefined && link.id !== null;
  const hasValues = link.values && link.values.length > 0;

  let size = 1; // type byte

  if (hasId) {
    size += varIntSize(link.id);
  }

  size += valueSize(link.source, sourceIsId);
  if (!isSelfRef) {
    size += valueSize(link.target, targetIsId);
  }

  if (hasValues) {
    size += varIntSize(link.values.length);
    for (const val of link.values) {
      size += valueSize(val, false);
    }
  }

  return size;
}

// =============================================================================
// BinaryNotation Class
// =============================================================================

/**
 * Binary Links Notation encoder/decoder.
 *
 * Provides methods for encoding links to binary format and decoding
 * binary data back to links.
 *
 * @example
 * import { BinaryNotation } from 'links-queue';
 *
 * // Encode links to binary
 * const buffer = BinaryNotation.encode([
 *   { id: 1, source: 2, target: 3 },
 *   { id: 2, source: 'type', target: 'enqueue' }
 * ]);
 *
 * // Decode binary back to links
 * const links = BinaryNotation.decode(buffer);
 *
 * // With options
 * const compressed = BinaryNotation.encode(links, {
 *   compress: true,
 *   version: 1
 * });
 */
export class BinaryNotation {
  /**
   * Encodes links to binary format.
   *
   * @param {import('../index.d.ts').Link | import('../index.d.ts').Link[]} links - Link(s) to encode
   * @param {EncodeOptions} [options] - Encoding options
   * @returns {Uint8Array} Encoded binary data
   *
   * @example
   * const buffer = BinaryNotation.encode({ id: 1, source: 2, target: 3 });
   * console.log(buffer); // Uint8Array
   */
  static encode(links, options = {}) {
    const linksArray = Array.isArray(links) ? links : [links];

    // Calculate required size
    let payloadSize = varIntSize(linksArray.length);
    for (const link of linksArray) {
      payloadSize += linkBodySize(link);
    }

    // Allocate buffer
    const buffer = new Uint8Array(HEADER_SIZE + payloadSize);
    const view = new DataView(buffer.buffer);

    // Write header
    view.setUint32(0, MAGIC, false); // big-endian
    view.setUint16(4, options.version ?? VERSION, false);
    buffer[6] = options.flags ?? 0;
    view.setUint32(7, payloadSize, false);

    // Write payload
    let offset = HEADER_SIZE;

    // Write link count
    offset += encodeVarInt(linksArray.length, buffer, offset);

    // Write each link
    for (const link of linksArray) {
      offset += encodeLinkBody(link, buffer, offset);
    }

    return buffer;
  }

  /**
   * Decodes binary data to links.
   *
   * @param {Uint8Array | ArrayBuffer} data - Binary data to decode
   * @param {DecodeOptions} [options] - Decoding options
   * @returns {import('../index.d.ts').Link[]} Decoded links
   * @throws {BinaryNotationError} If decoding fails
   *
   * @example
   * const links = BinaryNotation.decode(buffer);
   * console.log(links); // [{ id: 1, source: 2, target: 3 }]
   */
  static decode(data, options = {}) {
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (buffer.length < HEADER_SIZE) {
      throw new BinaryNotationError(
        `Buffer too small: expected at least ${HEADER_SIZE} bytes, got ${buffer.length}`,
        ERROR_TRUNCATED_MESSAGE,
        0
      );
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset);

    // Validate magic
    const magic = view.getUint32(0, false);
    if (magic !== MAGIC) {
      throw new BinaryNotationError(
        `Invalid magic number: expected 0x${MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
        ERROR_INVALID_MAGIC,
        0
      );
    }

    // Check version
    const version = view.getUint16(4, false);
    const majorVersion = (version >> 8) & 0xff;
    const expectedMajor = (VERSION >> 8) & 0xff;
    if (majorVersion > expectedMajor && !options.ignoreVersion) {
      throw new BinaryNotationError(
        `Unsupported version: ${majorVersion}.x (expected ${expectedMajor}.x or lower)`,
        ERROR_UNSUPPORTED_VERSION,
        4
      );
    }

    // Read flags
    const flags = buffer[6];

    // Validate flags
    if ((flags & FLAG_COMPRESSED) !== 0) {
      throw new BinaryNotationError(
        'Compression not yet supported',
        ERROR_INVALID_FLAGS,
        6
      );
    }

    // Read payload length
    const payloadLength = view.getUint32(7, false);

    if (buffer.length < HEADER_SIZE + payloadLength) {
      throw new BinaryNotationError(
        `Buffer truncated: expected ${HEADER_SIZE + payloadLength} bytes, got ${buffer.length}`,
        ERROR_TRUNCATED_MESSAGE,
        7
      );
    }

    // Decode payload
    let offset = HEADER_SIZE;

    // Read link count
    const countResult = decodeVarInt(buffer, offset);
    const count = countResult.value;
    offset += countResult.bytesRead;

    // Decode each link
    const links = [];
    for (let i = 0; i < count; i++) {
      const { link, bytesRead } = decodeLinkBody(buffer, offset);
      links.push(link);
      offset += bytesRead;
    }

    return links;
  }

  /**
   * Checks if data appears to be binary notation.
   *
   * @param {Uint8Array | ArrayBuffer} data - Data to check
   * @returns {boolean} True if data starts with binary notation magic number
   */
  static isBinary(data) {
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (buffer.length < 4) {
      return false;
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset);
    return view.getUint32(0, false) === MAGIC;
  }

  /**
   * Creates a stream encoder for incremental encoding.
   *
   * @param {StreamEncoderOptions} [options] - Encoder options
   * @returns {BinaryStreamEncoder} Stream encoder instance
   */
  static createStreamEncoder(options = {}) {
    return new BinaryStreamEncoder(options);
  }

  /**
   * Creates a stream decoder for incremental decoding.
   *
   * @param {StreamDecoderOptions} [options] - Decoder options
   * @returns {BinaryStreamDecoder} Stream decoder instance
   */
  static createStreamDecoder(options = {}) {
    return new BinaryStreamDecoder(options);
  }
}

// =============================================================================
// BinaryStreamEncoder
// =============================================================================

/**
 * Stream encoder for incremental binary encoding.
 *
 * @example
 * const encoder = BinaryNotation.createStreamEncoder();
 * encoder.write({ id: 1, source: 2, target: 3 });
 * encoder.write({ id: 2, source: 3, target: 4 });
 * const buffer = encoder.finish();
 */
export class BinaryStreamEncoder {
  /** @type {import('../index.d.ts').Link[]} */
  #links = [];

  /** @type {StreamEncoderOptions} */
  #options;

  /**
   * Creates a new stream encoder.
   *
   * @param {StreamEncoderOptions} [options] - Encoder options
   */
  constructor(options = {}) {
    this.#options = {
      chunkSize: options.chunkSize ?? 16384,
      compression: options.compression ?? null,
    };
  }

  /**
   * Writes a link to the encoder.
   *
   * @param {import('../index.d.ts').Link} link - Link to write
   * @returns {this} The encoder for chaining
   */
  write(link) {
    this.#links.push(link);
    return this;
  }

  /**
   * Gets the configured chunk size.
   *
   * @returns {number} Chunk size in bytes
   */
  getChunkSize() {
    return this.#options.chunkSize;
  }

  /**
   * Finishes encoding and returns the result.
   *
   * @returns {Uint8Array} Encoded binary data
   */
  finish() {
    const result = BinaryNotation.encode(this.#links);
    this.#links = [];
    return result;
  }

  /**
   * Resets the encoder for reuse.
   */
  reset() {
    this.#links = [];
  }
}

// =============================================================================
// BinaryStreamDecoder
// =============================================================================

/**
 * Stream decoder for incremental binary decoding.
 *
 * @example
 * const decoder = BinaryNotation.createStreamDecoder();
 * decoder.on('link', (link) => console.log(link));
 * decoder.on('end', () => console.log('Done'));
 * decoder.write(chunk1);
 * decoder.write(chunk2);
 * decoder.end();
 */
export class BinaryStreamDecoder {
  /** @type {Uint8Array} */
  #buffer = new Uint8Array(0);

  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /** @type {boolean} */
  #ended = false;

  /** @type {StreamDecoderOptions} */
  #options;

  /**
   * Creates a new stream decoder.
   *
   * @param {StreamDecoderOptions} [options] - Decoder options
   */
  constructor(options = {}) {
    this.#options = {
      maxBufferSize: options.maxBufferSize ?? 10 * 1024 * 1024,
    };
  }

  /**
   * Registers an event listener.
   *
   * @param {'link'|'error'|'end'} event - Event name
   * @param {Function} callback - Event handler
   * @returns {this} The decoder for chaining
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, []);
    }
    this.#listeners.get(event).push(callback);
    return this;
  }

  /**
   * Removes an event listener.
   *
   * @param {'link'|'error'|'end'} event - Event name
   * @param {Function} callback - Event handler to remove
   * @returns {this} The decoder for chaining
   */
  off(event, callback) {
    const listeners = this.#listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Writes data to the decoder buffer.
   *
   * @param {Uint8Array} chunk - Data chunk to add
   * @returns {this} The decoder for chaining
   */
  write(chunk) {
    if (this.#ended) {
      throw new Error('Cannot write to ended stream decoder');
    }

    // Append to buffer
    const newBuffer = new Uint8Array(this.#buffer.length + chunk.length);
    newBuffer.set(this.#buffer);
    newBuffer.set(chunk, this.#buffer.length);
    this.#buffer = newBuffer;

    if (this.#buffer.length > this.#options.maxBufferSize) {
      const error = new BinaryNotationError(
        'Buffer size exceeded maximum',
        ERROR_TRUNCATED_MESSAGE
      );
      this.#emit('error', error);
      throw error;
    }

    return this;
  }

  /**
   * Signals end of input and processes the buffer.
   */
  end() {
    if (this.#ended) {
      return;
    }
    this.#ended = true;

    try {
      const links = BinaryNotation.decode(this.#buffer);
      for (const link of links) {
        this.#emit('link', link);
      }
      this.#emit('end');
    } catch (error) {
      this.#emit('error', error);
    }

    this.#buffer = new Uint8Array(0);
  }

  /**
   * Emits an event to registered listeners.
   *
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @private
   */
  #emit(event, data) {
    const listeners = this.#listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }
}

// =============================================================================
// BufferPool
// =============================================================================

/**
 * Buffer pool for efficient buffer reuse.
 *
 * @example
 * const pool = new BufferPool({ maxPoolSize: 100 });
 * const buffer = pool.acquire(1024);
 * // Use buffer...
 * pool.release(buffer);
 */
export class BufferPool {
  /** @type {Uint8Array[][]} */
  #pools;

  /** @type {BufferPoolOptions} */
  #options;

  /**
   * Creates a new buffer pool.
   *
   * @param {BufferPoolOptions} [options] - Pool options
   */
  constructor(options = {}) {
    this.#options = {
      smallBufferSize: options.smallBufferSize ?? 256,
      mediumBufferSize: options.mediumBufferSize ?? 4096,
      largeBufferSize: options.largeBufferSize ?? 65536,
      maxPoolSize: options.maxPoolSize ?? 100,
    };
    this.#pools = [[], [], []]; // small, medium, large
  }

  /**
   * Acquires a buffer of at least the specified size.
   *
   * @param {number} minSize - Minimum buffer size
   * @returns {Uint8Array} Buffer from pool or new buffer
   */
  acquire(minSize) {
    let poolIndex;
    let bufferSize;

    if (minSize <= this.#options.smallBufferSize) {
      poolIndex = 0;
      bufferSize = this.#options.smallBufferSize;
    } else if (minSize <= this.#options.mediumBufferSize) {
      poolIndex = 1;
      bufferSize = this.#options.mediumBufferSize;
    } else if (minSize <= this.#options.largeBufferSize) {
      poolIndex = 2;
      bufferSize = this.#options.largeBufferSize;
    } else {
      // Too large for pool, allocate directly
      return new Uint8Array(minSize);
    }

    const pool = this.#pools[poolIndex];
    if (pool.length > 0) {
      return pool.pop();
    }

    return new Uint8Array(bufferSize);
  }

  /**
   * Releases a buffer back to the pool.
   *
   * @param {Uint8Array} buffer - Buffer to release
   */
  release(buffer) {
    const size = buffer.length;
    let poolIndex;

    if (size === this.#options.smallBufferSize) {
      poolIndex = 0;
    } else if (size === this.#options.mediumBufferSize) {
      poolIndex = 1;
    } else if (size === this.#options.largeBufferSize) {
      poolIndex = 2;
    } else {
      // Not a pooled size, discard
      return;
    }

    const pool = this.#pools[poolIndex];
    if (pool.length < this.#options.maxPoolSize) {
      pool.push(buffer);
    }
  }

  /**
   * Clears all buffers from the pool.
   */
  clear() {
    this.#pools = [[], [], []];
  }

  /**
   * Gets pool statistics.
   *
   * @returns {BufferPoolStats} Pool statistics
   */
  getStats() {
    return {
      smallBuffers: this.#pools[0].length,
      mediumBuffers: this.#pools[1].length,
      largeBuffers: this.#pools[2].length,
      totalBuffers:
        this.#pools[0].length + this.#pools[1].length + this.#pools[2].length,
    };
  }
}

// =============================================================================
// Type Definitions (JSDoc)
// =============================================================================

/**
 * Options for encoding to binary format.
 *
 * @typedef {Object} EncodeOptions
 * @property {boolean} [compress=false] - Enable compression
 * @property {number} [version] - Protocol version (default: current)
 * @property {number} [flags=0] - Additional flags
 */

/**
 * Options for decoding from binary format.
 *
 * @typedef {Object} DecodeOptions
 * @property {boolean} [ignoreVersion=false] - Skip version check
 */

/**
 * Options for stream encoder.
 *
 * @typedef {Object} StreamEncoderOptions
 * @property {number} [chunkSize=16384] - Chunk size for streaming
 * @property {string} [compression] - Compression algorithm ('zstd', 'lz4')
 */

/**
 * Options for stream decoder.
 *
 * @typedef {Object} StreamDecoderOptions
 * @property {number} [maxBufferSize=10485760] - Maximum buffer size
 */

/**
 * Options for buffer pool.
 *
 * @typedef {Object} BufferPoolOptions
 * @property {number} [smallBufferSize=256] - Size of small buffers
 * @property {number} [mediumBufferSize=4096] - Size of medium buffers
 * @property {number} [largeBufferSize=65536] - Size of large buffers
 * @property {number} [maxPoolSize=100] - Maximum buffers per pool
 */

/**
 * Buffer pool statistics.
 *
 * @typedef {Object} BufferPoolStats
 * @property {number} smallBuffers - Count of small buffers in pool
 * @property {number} mediumBuffers - Count of medium buffers in pool
 * @property {number} largeBuffers - Count of large buffers in pool
 * @property {number} totalBuffers - Total buffers in pool
 */
