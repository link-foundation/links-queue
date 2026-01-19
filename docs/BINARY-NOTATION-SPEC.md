# Binary Links Notation Specification

**Version**: 1.0.0
**Status**: Draft
**Authors**: links-queue contributors

## Overview

Binary Links Notation (BLN) is a compact binary encoding of Links Notation designed for high-performance data exchange in the Links Queue system. It provides 1.2-1.7x smaller message sizes compared to text notation while maintaining compatibility with the Links data model. Larger savings are achieved for numeric-heavy data, self-referencing links, and large batches.

## Design Goals

1. **Compact Encoding**: 1.2-1.7x smaller than text notation for typical workloads
2. **Zero-Copy Parsing**: Direct memory access where possible
3. **Forward/Backward Compatibility**: Version header for evolution
4. **Streaming Support**: Support for incremental encoding/decoding
5. **Buffer Pooling**: Enable buffer reuse for reduced allocations

## Wire Format

### Message Frame

Every binary message starts with a fixed 11-byte header:

```
┌────────┬────────┬────────┬─────────────────────────────────┐
│ Magic  │Version │ Flags  │ Length │       Payload          │
│ 4 bytes│ 2 bytes│ 1 byte │ 4 bytes│       Variable         │
└────────┴────────┴────────┴────────┴────────────────────────┘
```

#### Header Fields

| Field | Size | Description |
|-------|------|-------------|
| Magic | 4 bytes | Magic number `0x4C4E4B51` ("LNKQ") for protocol identification |
| Version | 2 bytes | Protocol version (big-endian, major.minor as high.low byte) |
| Flags | 1 byte | Message flags (compression, encoding options) |
| Length | 4 bytes | Payload length in bytes (big-endian, max 4GB) |

#### Flag Bits

| Bit | Name | Description |
|-----|------|-------------|
| 0 | COMPRESSED | Payload is compressed (using algorithm in bits 1-2) |
| 1-2 | COMPRESSION_ALG | 00=none, 01=zstd, 10=lz4, 11=reserved |
| 3 | HAS_CHECKSUM | 4-byte CRC32 appended after payload |
| 4 | STREAMING | Message is part of a stream |
| 5-7 | RESERVED | Reserved for future use |

### Link Encoding

Each link is encoded with a type byte followed by variable-length fields:

```
┌────────┬────────────┬────────────┬──────────────┐
│  Type  │   Source   │   Target   │  Values (opt) │
│ 1 byte │  Variable  │  Variable  │    Variable   │
└────────┴────────────┴────────────┴──────────────┘
```

#### Type Byte

| Bit | Name | Description |
|-----|------|-------------|
| 0 | SOURCE_IS_ID | Source is a link ID reference (vs inline link/literal) |
| 1 | TARGET_IS_ID | Target is a link ID reference (vs inline link/literal) |
| 2 | SELF_REF | Self-referencing link (source == target, only encode once) |
| 3 | HAS_ID | Link has an explicit ID |
| 4 | HAS_VALUES | Link has additional values array |
| 5-6 | ID_SIZE | 00=varint, 01=4 bytes, 10=8 bytes, 11=reserved |
| 7 | RESERVED | Reserved for future use |

### Value Encoding

Values can be:
- **Link ID references**: Encoded as varint
- **Inline links**: Recursively encoded links
- **Literals**: Type-prefixed data

#### Literal Types

| Type Byte | Type | Encoding |
|-----------|------|----------|
| 0x00 | Null | No additional bytes |
| 0x01 | Boolean False | No additional bytes |
| 0x02 | Boolean True | No additional bytes |
| 0x10 | VarInt | Variable-length integer |
| 0x11 | Int32 | 4 bytes (big-endian) |
| 0x12 | Int64 | 8 bytes (big-endian) |
| 0x13 | Float64 | 8 bytes (IEEE 754) |
| 0x20 | String (short) | 1-byte length + UTF-8 data (max 255 bytes) |
| 0x21 | String (medium) | 2-byte length + UTF-8 data (max 65535 bytes) |
| 0x22 | String (long) | 4-byte length + UTF-8 data |
| 0x30 | Binary (short) | 1-byte length + data (max 255 bytes) |
| 0x31 | Binary (medium) | 2-byte length + data (max 65535 bytes) |
| 0x32 | Binary (long) | 4-byte length + data |
| 0x40 | Link | Inline link encoding |

### VarInt Encoding

Variable-length integers use LEB128 encoding:
- Each byte has 7 data bits and 1 continuation bit (MSB)
- Continuation bit 1 = more bytes follow
- Continuation bit 0 = last byte
- Supports unsigned integers up to 64 bits

Example:
- `0` = `0x00`
- `127` = `0x7F`
- `128` = `0x80 0x01`
- `16383` = `0xFF 0x7F`

### Array Encoding

Arrays are encoded as:
```
┌─────────┬───────────┬───────────┬─────┐
│  Count  │  Element1 │  Element2 │ ... │
│ VarInt  │  Variable │  Variable │     │
└─────────┴───────────┴───────────┴─────┘
```

## Examples

### Simple Link `(1, 2)`

Text notation: `(1 2)` (5 bytes)
Binary encoding:
```
Type: 0x03 (SOURCE_IS_ID | TARGET_IS_ID)
Source: 0x01 (varint 1)
Target: 0x02 (varint 2)
Total: 3 bytes (40% reduction)
```

### Self-Referencing Link `(5: 5)`

Text notation: `(5: 5 5)` (10 bytes)
Binary encoding:
```
Type: 0x0F (SOURCE_IS_ID | TARGET_IS_ID | SELF_REF | HAS_ID)
ID: 0x05 (varint 5)
Total: 2 bytes (80% reduction)
```

### Named Link `(type: enqueue)`

Text notation: `(type: enqueue)` (15 bytes)
Binary encoding:
```
Type: 0x00
Source: 0x20 0x04 "type" (literal string)
Target: 0x20 0x07 "enqueue" (literal string)
Total: 15 bytes (same size - strings dominate)
```

### Nested Link `((1, 2), (3, 4))`

Text notation: `((1 2) (3 4))` (13 bytes)
Binary encoding:
```
Type: 0x00
Source: 0x40 (inline link marker)
  Type: 0x03
  Source: 0x01
  Target: 0x02
Target: 0x40 (inline link marker)
  Type: 0x03
  Source: 0x03
  Target: 0x04
Total: 9 bytes (31% reduction)
```

## Protocol Negotiation

### Capability Exchange

Clients and servers negotiate protocol using a capabilities message:

```javascript
{
  type: "capabilities",
  protocols: ["text/links-notation", "binary/links-notation"],
  preferredProtocol: "binary/links-notation",
  binaryVersion: "1.0",
  compression: ["zstd", "lz4"],
  maxMessageSize: 16777216
}
```

### Protocol Selection

1. Client sends capabilities on connect
2. Server responds with selected protocol
3. Subsequent messages use selected protocol
4. Either side can request protocol switch

### Fallback

If binary protocol parsing fails:
1. Reset to text notation
2. Log warning
3. Continue with text protocol
4. Retry binary after configurable delay

## Compression

### When to Compress

- Messages > 256 bytes SHOULD consider compression
- Messages > 1024 bytes SHOULD be compressed
- Compression can be disabled per-message or globally

### Compression Algorithms

| Algorithm | Ratio | Speed | Use Case |
|-----------|-------|-------|----------|
| None | 1x | Fastest | Small messages, low CPU |
| LZ4 | ~2x | Fast | General use, balanced |
| Zstd | ~3-4x | Medium | Large messages, batch |

## Buffer Pooling

### Pool Configuration

```javascript
const pool = new BinaryNotation.BufferPool({
  smallBufferSize: 256,
  mediumBufferSize: 4096,
  largeBufferSize: 65536,
  maxPoolSize: 100
});
```

### Usage Pattern

```javascript
// Acquire buffer
const buffer = pool.acquire(estimatedSize);

// Encode data
encoder.encode(links, buffer);

// Send/process
await send(buffer);

// Release back to pool
pool.release(buffer);
```

## Streaming

### Stream Encoder

```javascript
const encoder = new BinaryNotation.StreamEncoder({
  chunkSize: 16384,
  compression: 'zstd'
});

for (const link of links) {
  const chunk = encoder.write(link);
  if (chunk) {
    await send(chunk);
  }
}

const finalChunk = encoder.finish();
await send(finalChunk);
```

### Stream Decoder

```javascript
const decoder = new BinaryNotation.StreamDecoder();

decoder.on('link', (link) => {
  process(link);
});

decoder.on('error', (error) => {
  handleError(error);
});

socket.on('data', (chunk) => {
  decoder.write(chunk);
});
```

## Error Handling

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0x01 | INVALID_MAGIC | Magic number mismatch |
| 0x02 | UNSUPPORTED_VERSION | Protocol version not supported |
| 0x03 | INVALID_FLAGS | Unknown or invalid flags |
| 0x04 | TRUNCATED_MESSAGE | Message shorter than declared length |
| 0x05 | INVALID_TYPE | Unknown link type byte |
| 0x06 | INVALID_LITERAL | Malformed literal encoding |
| 0x07 | DECOMPRESSION_FAILED | Decompression error |
| 0x08 | CHECKSUM_MISMATCH | CRC32 checksum failed |

## Performance Considerations

### Encoding Tips

1. Use link ID references for repeated structures
2. Enable compression for messages > 1KB
3. Use buffer pooling for high-throughput scenarios
4. Prefer varint for small integers (< 128)

### Memory Layout

- Header is fixed 11 bytes for predictable parsing
- Links are packed without padding
- Strings are not null-terminated (length-prefixed)

## Security

### Message Size Limits

- Default max message size: 16 MB
- Configurable per-connection
- Exceeding limit closes connection

### Checksum Validation

- Optional CRC32 checksum for data integrity
- MUST validate before decompression
- MUST validate before processing

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01 | Initial specification |

## References

- [Links Notation](https://github.com/link-foundation/links-notation) - Text notation
- [LEB128](https://en.wikipedia.org/wiki/LEB128) - Variable-length encoding
- [Protocol Buffers](https://protobuf.dev/) - Inspiration for encoding
