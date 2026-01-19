/**
 * Binary Links Notation encoder/decoder type definitions.
 *
 * @module protocol/binary-notation
 */

import type { Link, LinkRef } from '../index.d.ts';

// =============================================================================
// Constants
// =============================================================================

/** Magic number for protocol identification: "LNKQ" */
export const MAGIC: number;

/** Current protocol version (1.0) */
export const VERSION: number;

/** Header size in bytes */
export const HEADER_SIZE: number;

// Flag bits
export const FLAG_COMPRESSED: number;
export const FLAG_COMPRESSION_MASK: number;
export const FLAG_COMPRESSION_ZSTD: number;
export const FLAG_COMPRESSION_LZ4: number;
export const FLAG_HAS_CHECKSUM: number;
export const FLAG_STREAMING: number;

// Link type bits
export const TYPE_SOURCE_IS_ID: number;
export const TYPE_TARGET_IS_ID: number;
export const TYPE_SELF_REF: number;
export const TYPE_HAS_ID: number;
export const TYPE_HAS_VALUES: number;
export const TYPE_ID_SIZE_MASK: number;
export const TYPE_ID_SIZE_VARINT: number;
export const TYPE_ID_SIZE_4BYTES: number;
export const TYPE_ID_SIZE_8BYTES: number;

// Literal type markers
export const LITERAL_NULL: number;
export const LITERAL_FALSE: number;
export const LITERAL_TRUE: number;
export const LITERAL_VARINT: number;
export const LITERAL_INT32: number;
export const LITERAL_INT64: number;
export const LITERAL_FLOAT64: number;
export const LITERAL_STRING_SHORT: number;
export const LITERAL_STRING_MEDIUM: number;
export const LITERAL_STRING_LONG: number;
export const LITERAL_BINARY_SHORT: number;
export const LITERAL_BINARY_MEDIUM: number;
export const LITERAL_BINARY_LONG: number;
export const LITERAL_LINK: number;

// Error codes
export const ERROR_INVALID_MAGIC: number;
export const ERROR_UNSUPPORTED_VERSION: number;
export const ERROR_INVALID_FLAGS: number;
export const ERROR_TRUNCATED_MESSAGE: number;
export const ERROR_INVALID_TYPE: number;
export const ERROR_INVALID_LITERAL: number;
export const ERROR_DECOMPRESSION_FAILED: number;
export const ERROR_CHECKSUM_MISMATCH: number;

// =============================================================================
// BinaryNotationError
// =============================================================================

/**
 * Error thrown when binary notation encoding/decoding fails.
 */
export class BinaryNotationError extends Error {
  name: 'BinaryNotationError';
  code: number;
  position: number | null;

  constructor(message: string, code: number, position?: number | null);
}

// =============================================================================
// VarInt Functions
// =============================================================================

/**
 * Encodes a number as a variable-length integer (LEB128).
 */
export function encodeVarInt(
  value: number | bigint,
  buffer: Uint8Array,
  offset: number
): number;

/**
 * Decodes a variable-length integer (LEB128).
 */
export function decodeVarInt(
  buffer: Uint8Array,
  offset: number
): { value: number | bigint; bytesRead: number };

/**
 * Gets the number of bytes needed to encode a value as varint.
 */
export function varIntSize(value: number | bigint): number;

// =============================================================================
// String Functions
// =============================================================================

/**
 * Encodes a string to the buffer.
 */
export function encodeString(
  str: string,
  buffer: Uint8Array,
  offset: number
): number;

/**
 * Decodes a string from the buffer.
 */
export function decodeString(
  buffer: Uint8Array,
  offset: number
): { value: string; bytesRead: number };

/**
 * Gets the number of bytes needed to encode a string.
 */
export function stringSize(str: string): number;

// =============================================================================
// Value Functions
// =============================================================================

/**
 * Encodes a value (link reference or literal) to the buffer.
 */
export function encodeValue(
  value: unknown,
  buffer: Uint8Array,
  offset: number,
  asId?: boolean
): number;

/**
 * Decodes a value from the buffer.
 */
export function decodeValue(
  buffer: Uint8Array,
  offset: number,
  asId?: boolean
): { value: unknown; bytesRead: number };

/**
 * Gets the number of bytes needed to encode a value.
 */
export function valueSize(value: unknown, asId?: boolean): number;

// =============================================================================
// Link Body Functions
// =============================================================================

/**
 * Encodes a link body (without the LITERAL_LINK marker).
 */
export function encodeLinkBody(
  link: Link,
  buffer: Uint8Array,
  offset: number
): number;

/**
 * Decodes a link body from the buffer.
 */
export function decodeLinkBody(
  buffer: Uint8Array,
  offset: number
): { link: Link; bytesRead: number };

/**
 * Gets the number of bytes needed to encode a link body.
 */
export function linkBodySize(link: Link): number;

// =============================================================================
// BinaryNotation Class
// =============================================================================

/**
 * Options for encoding to binary format.
 */
export interface EncodeOptions {
  /** Enable compression */
  compress?: boolean;
  /** Protocol version (default: current) */
  version?: number;
  /** Additional flags */
  flags?: number;
}

/**
 * Options for decoding from binary format.
 */
export interface DecodeOptions {
  /** Skip version check */
  ignoreVersion?: boolean;
}

/**
 * Options for stream encoder.
 */
export interface StreamEncoderOptions {
  /** Chunk size for streaming */
  chunkSize?: number;
  /** Compression algorithm ('zstd', 'lz4') */
  compression?: string | null;
}

/**
 * Options for stream decoder.
 */
export interface StreamDecoderOptions {
  /** Maximum buffer size */
  maxBufferSize?: number;
}

/**
 * Binary Links Notation encoder/decoder.
 */
export class BinaryNotation {
  /**
   * Encodes links to binary format.
   */
  static encode(links: Link | Link[], options?: EncodeOptions): Uint8Array;

  /**
   * Decodes binary data to links.
   */
  static decode(
    data: Uint8Array | ArrayBuffer,
    options?: DecodeOptions
  ): Link[];

  /**
   * Checks if data appears to be binary notation.
   */
  static isBinary(data: Uint8Array | ArrayBuffer): boolean;

  /**
   * Creates a stream encoder for incremental encoding.
   */
  static createStreamEncoder(
    options?: StreamEncoderOptions
  ): BinaryStreamEncoder;

  /**
   * Creates a stream decoder for incremental decoding.
   */
  static createStreamDecoder(
    options?: StreamDecoderOptions
  ): BinaryStreamDecoder;
}

// =============================================================================
// BinaryStreamEncoder
// =============================================================================

/**
 * Stream encoder for incremental binary encoding.
 */
export class BinaryStreamEncoder {
  constructor(options?: StreamEncoderOptions);

  /**
   * Writes a link to the encoder.
   */
  write(link: Link): this;

  /**
   * Finishes encoding and returns the result.
   */
  finish(): Uint8Array;

  /**
   * Resets the encoder for reuse.
   */
  reset(): void;
}

// =============================================================================
// BinaryStreamDecoder
// =============================================================================

/** Events emitted by BinaryStreamDecoder */
export type BinaryStreamDecoderEvent = 'link' | 'error' | 'end';

/**
 * Stream decoder for incremental binary decoding.
 */
export class BinaryStreamDecoder {
  constructor(options?: StreamDecoderOptions);

  /**
   * Registers an event listener.
   */
  on(event: 'link', callback: (link: Link) => void): this;
  on(event: 'error', callback: (error: Error) => void): this;
  on(event: 'end', callback: () => void): this;

  /**
   * Removes an event listener.
   */
  off(event: BinaryStreamDecoderEvent, callback: Function): this;

  /**
   * Writes data to the decoder buffer.
   */
  write(chunk: Uint8Array): this;

  /**
   * Signals end of input and processes the buffer.
   */
  end(): void;
}

// =============================================================================
// BufferPool
// =============================================================================

/**
 * Options for buffer pool.
 */
export interface BufferPoolOptions {
  /** Size of small buffers */
  smallBufferSize?: number;
  /** Size of medium buffers */
  mediumBufferSize?: number;
  /** Size of large buffers */
  largeBufferSize?: number;
  /** Maximum buffers per pool */
  maxPoolSize?: number;
}

/**
 * Buffer pool statistics.
 */
export interface BufferPoolStats {
  /** Count of small buffers in pool */
  smallBuffers: number;
  /** Count of medium buffers in pool */
  mediumBuffers: number;
  /** Count of large buffers in pool */
  largeBuffers: number;
  /** Total buffers in pool */
  totalBuffers: number;
}

/**
 * Buffer pool for efficient buffer reuse.
 */
export class BufferPool {
  constructor(options?: BufferPoolOptions);

  /**
   * Acquires a buffer of at least the specified size.
   */
  acquire(minSize: number): Uint8Array;

  /**
   * Releases a buffer back to the pool.
   */
  release(buffer: Uint8Array): void;

  /**
   * Clears all buffers from the pool.
   */
  clear(): void;

  /**
   * Gets pool statistics.
   */
  getStats(): BufferPoolStats;
}
