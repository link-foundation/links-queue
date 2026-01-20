# Binary Links Notation Migration Guide

This guide helps you migrate from text-based Links Notation to the new Binary Links Notation format for improved performance.

## Overview

Binary Links Notation (BLN) provides:
- **1.2-1.7x smaller message sizes** for typical workloads
- **Zero-copy parsing potential** for high-performance scenarios
- **Backward compatibility** with text notation via protocol negotiation
- **Streaming support** for incremental encoding/decoding

## Quick Start

### JavaScript

```javascript
import { BinaryNotation } from 'links-queue/protocol/binary-notation';
import { createLink } from 'links-queue';

// Create links
const links = [
  createLink(1, 2, 3),
  createLink(4, 5, 6),
];

// Encode to binary
const encoded = BinaryNotation.encode(links);

// Decode from binary
const decoded = BinaryNotation.decode(encoded);
```

### Rust

```rust
use links_queue::backends::binary_notation::{BinaryNotation, EncodedLink};

// Create links
let links = vec![
    EncodedLink::new_simple(2, 3),
    EncodedLink::new_with_id(1, 2, 3),
];

// Encode to binary
let encoded = BinaryNotation::encode(&links)?;

// Decode from binary
let decoded = BinaryNotation::decode(&encoded)?;
```

## Protocol Negotiation

The protocol negotiation mechanism allows clients and servers to agree on the best protocol:

```javascript
import {
  ProtocolConnection,
  ProtocolCapabilities
} from 'links-queue/protocol/negotiation';

// Client with binary support
const clientCaps = ProtocolCapabilities.withBinarySupport();
const client = new ProtocolConnection(clientCaps);

// Server with binary support
const serverCaps = ProtocolCapabilities.withBinarySupport();
const server = new ProtocolConnection(serverCaps);

// Negotiation flow
const clientHello = client.initiateNegotiation();
const serverResponse = server.handleCapabilities(clientHello);
client.handleNegotiationResult(serverResponse);

// Both sides now use the negotiated protocol
console.log(client.getProtocol()); // 'binary/links-notation'
```

## Size Comparison

Based on benchmark tests with typical link patterns:

| Link Type | Text Size | Binary Size | Savings |
|-----------|-----------|-------------|---------|
| 100 simple links | 686 bytes | 412 bytes | 1.67x |
| 1000 simple links | 8789 bytes | 6632 bytes | 1.33x |
| 100 self-ref links | 390 bytes | 312 bytes | 1.25x |
| 100 large-ID links | 1700 bytes | 1012 bytes | 1.68x |
| 50 nested links | 814 bytes | 662 bytes | 1.23x |
| 100 links with values | 1580 bytes | 1112 bytes | 1.42x |

**Note**: String-heavy links see minimal improvement since strings must be stored in full regardless of format.

## Migration Strategies

### Strategy 1: Gradual Migration (Recommended)

1. **Deploy with protocol negotiation enabled**
   - Both text and binary protocols are supported
   - Servers negotiate the best protocol per-connection

2. **Update clients incrementally**
   - New clients use binary by default
   - Old clients continue using text protocol

3. **Monitor performance**
   - Track message sizes and throughput
   - Compare binary vs text connections

### Strategy 2: Full Migration

1. **Update all clients and servers simultaneously**
2. **Disable text protocol fallback**
3. **Best for controlled environments**

## API Reference

### BinaryNotation Class

```javascript
// Static encode method
const encoded = BinaryNotation.encode(links, options);

// Static decode method
const decoded = BinaryNotation.decode(buffer, options);

// Check if data is binary format
const isBinary = BinaryNotation.isBinary(data);

// Get estimated encoded size
const size = BinaryNotation.estimateSize(links);
```

### Streaming API

```javascript
// Encoder for streaming
const encoder = new BinaryStreamEncoder({ chunkSize: 16384 });

for (const link of links) {
  const chunk = encoder.write(link);
  if (chunk) {
    await send(chunk);
  }
}

const finalChunk = encoder.finish();
await send(finalChunk);

// Decoder for streaming
const decoder = new BinaryStreamDecoder();

decoder.onLink = (link) => {
  process(link);
};

socket.on('data', (data) => {
  decoder.write(data);
});

decoder.finish();
```

### Protocol Negotiation API

```javascript
// Create capabilities
const caps = new ProtocolCapabilities({
  protocols: ['binary/links-notation', 'text/links-notation'],
  preferredProtocol: 'binary/links-notation',
  binaryVersion: '1.0',
  compression: ['none'],
  maxMessageSize: 16 * 1024 * 1024
});

// Or use convenience methods
const binaryCaps = ProtocolCapabilities.withBinarySupport();
const textCaps = ProtocolCapabilities.textOnly();

// Protocol connection
const conn = new ProtocolConnection(caps);
conn.initiateNegotiation();
conn.handleCapabilities(remoteCaps);
conn.handleNegotiationResult(result);

// Encode/decode with negotiated protocol
const encoded = conn.encode(links);
const decoded = conn.decode(data);
```

## Error Handling

```javascript
import { BinaryNotationError } from 'links-queue/protocol/binary-notation';

try {
  const decoded = BinaryNotation.decode(buffer);
} catch (error) {
  if (error instanceof BinaryNotationError) {
    console.error(`Binary decode error: ${error.message}`);
    console.error(`Error code: ${error.code}`);
    console.error(`Position: ${error.position}`);

    // Fall back to text parsing if needed
    const text = new TextDecoder().decode(buffer);
    const decoded = LinksNotation.parse(text);
  }
}
```

## Best Practices

### When to Use Binary Notation

- **High-throughput scenarios**: Message queues, real-time streaming
- **Bandwidth-constrained environments**: Mobile apps, IoT devices
- **Numeric-heavy data**: Links with mostly numeric IDs
- **Large batches**: Encoding many links together

### When Text Notation May Be Better

- **Debugging**: Text is human-readable
- **String-heavy data**: Binary provides minimal savings
- **Single links**: Header overhead negates savings
- **Interoperability**: When other systems only support text

### Performance Tips

1. **Batch links together** - Header overhead is amortized over multiple links
2. **Use link ID references** - When referring to links by ID instead of embedding
3. **Enable compression** - For messages > 1KB (when compression is implemented)
4. **Use buffer pooling** - For high-throughput scenarios

## Troubleshooting

### Common Issues

**Binary data not decoding**
- Ensure you're passing a `Uint8Array`, not a string
- Check magic number: first 4 bytes should be `0x4C4E4B51` ("LNKQ")

**Nested links returning numbers**
- This was a bug fixed in version X.X.X
- Update to the latest version

**Protocol negotiation failing**
- Ensure both sides have matching protocol versions
- Check that capabilities are sent before data

### Debug Mode

```javascript
// Enable debug logging
BinaryNotation.setDebug(true);

// Inspect encoded bytes
const encoded = BinaryNotation.encode(links);
console.log('Encoded hex:', Buffer.from(encoded).toString('hex'));
```

## Version Compatibility

| Binary Version | JS Package | Rust Crate |
|----------------|------------|------------|
| 1.0 | >= 0.12.0 | >= 0.1.0 |

## See Also

- [Binary Notation Specification](./BINARY-NOTATION-SPEC.md)
- [Protocol Negotiation](./BINARY-NOTATION-SPEC.md#protocol-negotiation)
- [Links Notation](https://github.com/link-foundation/links-notation)
