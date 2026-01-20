/**
 * Tests for protocol negotiation module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  Protocol,
  ProtocolVersion,
  CompressionAlgorithm,
  ProtocolCapabilities,
  NegotiationResult,
  ProtocolNegotiator,
  ProtocolCodec,
  ConnectionState,
  ProtocolConnection,
} from '../src/protocol/negotiation.js';

import { BinaryNotation } from '../src/protocol/binary-notation.js';

// =============================================================================
// Protocol Constants Tests
// =============================================================================

describe('Protocol Constants', () => {
  it('should define protocol types', () => {
    assert.strictEqual(Protocol.TEXT, 'text/links-notation');
    assert.strictEqual(Protocol.BINARY, 'binary/links-notation');
  });

  it('should define protocol versions', () => {
    assert.strictEqual(ProtocolVersion.BINARY_V1, '1.0');
    assert.strictEqual(ProtocolVersion.TEXT_V1, '1.0');
  });

  it('should define compression algorithms', () => {
    assert.strictEqual(CompressionAlgorithm.NONE, 'none');
    assert.strictEqual(CompressionAlgorithm.ZSTD, 'zstd');
    assert.strictEqual(CompressionAlgorithm.LZ4, 'lz4');
  });

  it('should define connection states', () => {
    assert.strictEqual(ConnectionState.INITIAL, 'initial');
    assert.strictEqual(
      ConnectionState.AWAITING_CAPABILITIES,
      'awaiting_capabilities'
    );
    assert.strictEqual(ConnectionState.NEGOTIATED, 'negotiated');
    assert.strictEqual(ConnectionState.FAILED, 'failed');
  });
});

// =============================================================================
// ProtocolCapabilities Tests
// =============================================================================

describe('ProtocolCapabilities', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const caps = new ProtocolCapabilities();
      assert.deepStrictEqual(caps.protocols, [Protocol.TEXT]);
      assert.strictEqual(caps.preferredProtocol, Protocol.TEXT);
      assert.strictEqual(caps.binaryVersion, null);
      assert.deepStrictEqual(caps.compression, [CompressionAlgorithm.NONE]);
      assert.strictEqual(caps.maxMessageSize, 16 * 1024 * 1024);
    });

    it('should create with custom options', () => {
      const caps = new ProtocolCapabilities({
        protocols: [Protocol.BINARY, Protocol.TEXT],
        preferredProtocol: Protocol.BINARY,
        binaryVersion: '1.0',
        compression: [CompressionAlgorithm.ZSTD],
        maxMessageSize: 8 * 1024 * 1024,
      });

      assert.deepStrictEqual(caps.protocols, [Protocol.BINARY, Protocol.TEXT]);
      assert.strictEqual(caps.preferredProtocol, Protocol.BINARY);
      assert.strictEqual(caps.binaryVersion, '1.0');
      assert.deepStrictEqual(caps.compression, [CompressionAlgorithm.ZSTD]);
      assert.strictEqual(caps.maxMessageSize, 8 * 1024 * 1024);
    });
  });

  describe('withBinarySupport', () => {
    it('should create capabilities with binary support', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      assert.deepStrictEqual(caps.protocols, [Protocol.BINARY, Protocol.TEXT]);
      assert.strictEqual(caps.preferredProtocol, Protocol.BINARY);
      assert.strictEqual(caps.binaryVersion, '1.0');
      assert.ok(caps.supportsBinary());
    });

    it('should accept custom options', () => {
      const caps = ProtocolCapabilities.withBinarySupport({
        compression: [CompressionAlgorithm.LZ4],
        maxMessageSize: 4 * 1024 * 1024,
      });
      assert.deepStrictEqual(caps.compression, [CompressionAlgorithm.LZ4]);
      assert.strictEqual(caps.maxMessageSize, 4 * 1024 * 1024);
    });
  });

  describe('textOnly', () => {
    it('should create text-only capabilities', () => {
      const caps = ProtocolCapabilities.textOnly();
      assert.deepStrictEqual(caps.protocols, [Protocol.TEXT]);
      assert.strictEqual(caps.preferredProtocol, Protocol.TEXT);
      assert.strictEqual(caps.binaryVersion, null);
      assert.ok(!caps.supportsBinary());
    });
  });

  describe('supportsBinary', () => {
    it('should return true when binary is supported', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      assert.strictEqual(caps.supportsBinary(), true);
    });

    it('should return false when binary is not supported', () => {
      const caps = ProtocolCapabilities.textOnly();
      assert.strictEqual(caps.supportsBinary(), false);
    });
  });

  describe('supportsCompression', () => {
    it('should return true for supported compression', () => {
      const caps = new ProtocolCapabilities({
        compression: [CompressionAlgorithm.ZSTD, CompressionAlgorithm.LZ4],
      });
      assert.strictEqual(
        caps.supportsCompression(CompressionAlgorithm.ZSTD),
        true
      );
      assert.strictEqual(
        caps.supportsCompression(CompressionAlgorithm.LZ4),
        true
      );
    });

    it('should return false for unsupported compression', () => {
      const caps = new ProtocolCapabilities({
        compression: [CompressionAlgorithm.NONE],
      });
      assert.strictEqual(
        caps.supportsCompression(CompressionAlgorithm.ZSTD),
        false
      );
    });
  });

  describe('JSON serialization', () => {
    it('should convert to JSON', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const json = caps.toJSON();

      assert.strictEqual(json.type, 'capabilities');
      assert.deepStrictEqual(json.protocols, [Protocol.BINARY, Protocol.TEXT]);
      assert.strictEqual(json.preferredProtocol, Protocol.BINARY);
      assert.strictEqual(json.binaryVersion, '1.0');
    });

    it('should create from JSON', () => {
      const json = {
        type: 'capabilities',
        protocols: [Protocol.BINARY],
        preferredProtocol: Protocol.BINARY,
        binaryVersion: '1.0',
        compression: [CompressionAlgorithm.ZSTD],
        maxMessageSize: 1024,
      };

      const caps = ProtocolCapabilities.fromJSON(json);
      assert.deepStrictEqual(caps.protocols, [Protocol.BINARY]);
      assert.strictEqual(caps.preferredProtocol, Protocol.BINARY);
      assert.strictEqual(caps.maxMessageSize, 1024);
    });

    it('should roundtrip through JSON', () => {
      const original = ProtocolCapabilities.withBinarySupport({
        compression: [CompressionAlgorithm.LZ4],
      });
      const json = original.toJSON();
      const restored = ProtocolCapabilities.fromJSON(json);

      assert.deepStrictEqual(restored.protocols, original.protocols);
      assert.strictEqual(
        restored.preferredProtocol,
        original.preferredProtocol
      );
      assert.strictEqual(restored.binaryVersion, original.binaryVersion);
      assert.deepStrictEqual(restored.compression, original.compression);
    });
  });
});

// =============================================================================
// NegotiationResult Tests
// =============================================================================

describe('NegotiationResult', () => {
  describe('constructor', () => {
    it('should create with required options', () => {
      const result = new NegotiationResult({
        protocol: Protocol.BINARY,
      });

      assert.strictEqual(result.protocol, Protocol.BINARY);
      assert.strictEqual(result.version, null);
      assert.strictEqual(result.compression, null);
      assert.strictEqual(result.maxMessageSize, 16 * 1024 * 1024);
    });

    it('should create with all options', () => {
      const result = new NegotiationResult({
        protocol: Protocol.BINARY,
        version: '1.0',
        compression: CompressionAlgorithm.ZSTD,
        maxMessageSize: 8 * 1024 * 1024,
      });

      assert.strictEqual(result.protocol, Protocol.BINARY);
      assert.strictEqual(result.version, '1.0');
      assert.strictEqual(result.compression, CompressionAlgorithm.ZSTD);
      assert.strictEqual(result.maxMessageSize, 8 * 1024 * 1024);
    });
  });

  describe('isBinary', () => {
    it('should return true for binary protocol', () => {
      const result = new NegotiationResult({ protocol: Protocol.BINARY });
      assert.strictEqual(result.isBinary(), true);
    });

    it('should return false for text protocol', () => {
      const result = new NegotiationResult({ protocol: Protocol.TEXT });
      assert.strictEqual(result.isBinary(), false);
    });
  });

  describe('isText', () => {
    it('should return true for text protocol', () => {
      const result = new NegotiationResult({ protocol: Protocol.TEXT });
      assert.strictEqual(result.isText(), true);
    });

    it('should return false for binary protocol', () => {
      const result = new NegotiationResult({ protocol: Protocol.BINARY });
      assert.strictEqual(result.isText(), false);
    });
  });

  describe('JSON serialization', () => {
    it('should convert to JSON', () => {
      const result = new NegotiationResult({
        protocol: Protocol.BINARY,
        version: '1.0',
      });
      const json = result.toJSON();

      assert.strictEqual(json.type, 'negotiation_result');
      assert.strictEqual(json.protocol, Protocol.BINARY);
      assert.strictEqual(json.version, '1.0');
    });

    it('should roundtrip through JSON', () => {
      const original = new NegotiationResult({
        protocol: Protocol.BINARY,
        version: '1.0',
        compression: CompressionAlgorithm.ZSTD,
      });
      const json = original.toJSON();
      const restored = NegotiationResult.fromJSON(json);

      assert.strictEqual(restored.protocol, original.protocol);
      assert.strictEqual(restored.version, original.version);
      assert.strictEqual(restored.compression, original.compression);
    });
  });
});

// =============================================================================
// ProtocolNegotiator Tests
// =============================================================================

describe('ProtocolNegotiator', () => {
  describe('negotiate', () => {
    it('should negotiate binary when both support it', () => {
      const local = ProtocolCapabilities.withBinarySupport();
      const remote = ProtocolCapabilities.withBinarySupport();

      const negotiator = new ProtocolNegotiator(local);
      const result = negotiator.negotiate(remote);

      assert.strictEqual(result.protocol, Protocol.BINARY);
      assert.strictEqual(result.version, '1.0');
    });

    it('should fall back to text when remote only supports text', () => {
      const local = ProtocolCapabilities.withBinarySupport();
      const remote = ProtocolCapabilities.textOnly();

      const negotiator = new ProtocolNegotiator(local);
      const result = negotiator.negotiate(remote);

      assert.strictEqual(result.protocol, Protocol.TEXT);
    });

    it('should fall back to text when local only supports text', () => {
      const local = ProtocolCapabilities.textOnly();
      const remote = ProtocolCapabilities.withBinarySupport();

      const negotiator = new ProtocolNegotiator(local);
      const result = negotiator.negotiate(remote);

      assert.strictEqual(result.protocol, Protocol.TEXT);
    });

    it('should negotiate compression when both support it', () => {
      const local = new ProtocolCapabilities({
        protocols: [Protocol.BINARY],
        compression: [CompressionAlgorithm.ZSTD, CompressionAlgorithm.NONE],
      });
      const remote = new ProtocolCapabilities({
        protocols: [Protocol.BINARY],
        compression: [CompressionAlgorithm.ZSTD, CompressionAlgorithm.NONE],
      });

      const negotiator = new ProtocolNegotiator(local);
      const result = negotiator.negotiate(remote);

      assert.strictEqual(result.compression, CompressionAlgorithm.ZSTD);
    });

    it('should fall back to no compression when no common algorithm', () => {
      const local = new ProtocolCapabilities({
        protocols: [Protocol.BINARY],
        compression: [CompressionAlgorithm.ZSTD],
      });
      const remote = new ProtocolCapabilities({
        protocols: [Protocol.BINARY],
        compression: [CompressionAlgorithm.LZ4],
      });

      const negotiator = new ProtocolNegotiator(local);
      const result = negotiator.negotiate(remote);

      assert.strictEqual(result.compression, CompressionAlgorithm.NONE);
    });

    it('should use minimum max message size', () => {
      const local = new ProtocolCapabilities({
        maxMessageSize: 10 * 1024 * 1024,
      });
      const remote = new ProtocolCapabilities({
        maxMessageSize: 5 * 1024 * 1024,
      });

      const negotiator = new ProtocolNegotiator(local);
      const result = negotiator.negotiate(remote);

      assert.strictEqual(result.maxMessageSize, 5 * 1024 * 1024);
    });
  });

  describe('getResult', () => {
    it('should return null before negotiation', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const negotiator = new ProtocolNegotiator(caps);
      assert.strictEqual(negotiator.getResult(), null);
    });

    it('should return result after negotiation', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const negotiator = new ProtocolNegotiator(caps);
      negotiator.negotiate(ProtocolCapabilities.withBinarySupport());

      const result = negotiator.getResult();
      assert.ok(result !== null);
      assert.strictEqual(result.protocol, Protocol.BINARY);
    });
  });

  describe('reset', () => {
    it('should clear negotiation result', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const negotiator = new ProtocolNegotiator(caps);
      negotiator.negotiate(ProtocolCapabilities.withBinarySupport());

      assert.ok(negotiator.getResult() !== null);

      negotiator.reset();
      assert.strictEqual(negotiator.getResult(), null);
    });
  });
});

// =============================================================================
// ProtocolCodec Tests
// =============================================================================

describe('ProtocolCodec', () => {
  describe('constructor', () => {
    it('should create without negotiation result', () => {
      const codec = new ProtocolCodec();
      assert.strictEqual(codec.negotiationResult, null);
      assert.strictEqual(codec.isBinaryMode(), false);
    });

    it('should create with negotiation result', () => {
      const result = new NegotiationResult({ protocol: Protocol.BINARY });
      const codec = new ProtocolCodec(result);
      assert.strictEqual(codec.isBinaryMode(), true);
    });
  });

  describe('setNegotiationResult', () => {
    it('should update negotiation result', () => {
      const codec = new ProtocolCodec();
      assert.strictEqual(codec.isBinaryMode(), false);

      const result = new NegotiationResult({ protocol: Protocol.BINARY });
      codec.setNegotiationResult(result);
      assert.strictEqual(codec.isBinaryMode(), true);
    });
  });

  describe('encode/decode', () => {
    it('should encode/decode in text mode', () => {
      const result = new NegotiationResult({ protocol: Protocol.TEXT });
      const codec = new ProtocolCodec(result);

      const links = [
        {
          id: 1,
          source: { type: 'Int', value: 2 },
          target: { type: 'Int', value: 3 },
        },
      ];
      const encoded = codec.encode(links);
      assert.strictEqual(typeof encoded, 'string');

      const decoded = codec.decode(encoded);
      assert.strictEqual(decoded.length, 1);
    });

    it('should encode/decode in binary mode', () => {
      const result = new NegotiationResult({ protocol: Protocol.BINARY });
      const codec = new ProtocolCodec(result);

      const links = [
        {
          id: 1,
          source: { type: 'Int', value: 2 },
          target: { type: 'Int', value: 3 },
        },
      ];
      const encoded = codec.encode(links);
      assert.ok(encoded instanceof Uint8Array);

      const decoded = codec.decode(encoded);
      assert.strictEqual(decoded.length, 1);
    });
  });

  describe('detectProtocol', () => {
    it('should detect binary protocol', () => {
      const links = [
        {
          id: 1,
          source: { type: 'Int', value: 2 },
          target: { type: 'Int', value: 3 },
        },
      ];
      const buffer = BinaryNotation.encode(links);
      assert.strictEqual(ProtocolCodec.detectProtocol(buffer), Protocol.BINARY);
    });

    it('should detect text protocol', () => {
      const text = 'some text';
      assert.strictEqual(ProtocolCodec.detectProtocol(text), Protocol.TEXT);
    });

    it('should detect text from non-binary buffer', () => {
      const buffer = new TextEncoder().encode('not binary');
      assert.strictEqual(ProtocolCodec.detectProtocol(buffer), Protocol.TEXT);
    });
  });
});

// =============================================================================
// ProtocolConnection Tests
// =============================================================================

describe('ProtocolConnection', () => {
  describe('constructor', () => {
    it('should create in initial state', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const conn = new ProtocolConnection(caps);

      assert.strictEqual(conn.state, ConnectionState.INITIAL);
      assert.strictEqual(conn.isReady(), false);
      assert.strictEqual(conn.getProtocol(), null);
    });
  });

  describe('initiateNegotiation', () => {
    it('should return capabilities and update state', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const conn = new ProtocolConnection(caps);

      const message = conn.initiateNegotiation();

      assert.strictEqual(message.type, 'capabilities');
      assert.strictEqual(conn.state, ConnectionState.AWAITING_CAPABILITIES);
    });
  });

  describe('handleCapabilities', () => {
    it('should negotiate and return result', () => {
      const localCaps = ProtocolCapabilities.withBinarySupport();
      const remoteCaps = ProtocolCapabilities.withBinarySupport();

      const conn = new ProtocolConnection(localCaps);
      const result = conn.handleCapabilities(remoteCaps.toJSON());

      assert.strictEqual(result.type, 'negotiation_result');
      assert.strictEqual(result.protocol, Protocol.BINARY);
      assert.strictEqual(conn.state, ConnectionState.NEGOTIATED);
      assert.strictEqual(conn.isReady(), true);
    });

    it('should fall back to text for text-only remote', () => {
      const localCaps = ProtocolCapabilities.withBinarySupport();
      const remoteCaps = ProtocolCapabilities.textOnly();

      const conn = new ProtocolConnection(localCaps);
      const result = conn.handleCapabilities(remoteCaps.toJSON());

      assert.strictEqual(result.protocol, Protocol.TEXT);
    });
  });

  describe('handleNegotiationResult', () => {
    it('should accept negotiation result', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const conn = new ProtocolConnection(caps);

      const result = new NegotiationResult({ protocol: Protocol.BINARY });
      conn.handleNegotiationResult(result.toJSON());

      assert.strictEqual(conn.state, ConnectionState.NEGOTIATED);
      assert.strictEqual(conn.getProtocol(), Protocol.BINARY);
    });
  });

  describe('encode/decode', () => {
    it('should encode/decode after negotiation', () => {
      const localCaps = ProtocolCapabilities.withBinarySupport();
      const remoteCaps = ProtocolCapabilities.withBinarySupport();

      const conn = new ProtocolConnection(localCaps);
      conn.handleCapabilities(remoteCaps.toJSON());

      const links = [
        {
          id: 1,
          source: { type: 'Int', value: 2 },
          target: { type: 'Int', value: 3 },
        },
      ];
      const encoded = conn.encode(links);
      const decoded = conn.decode(encoded);

      assert.strictEqual(decoded.length, 1);
    });

    it('should throw if not ready', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const conn = new ProtocolConnection(caps);

      const links = [
        {
          id: 1,
          source: { type: 'Int', value: 2 },
          target: { type: 'Int', value: 3 },
        },
      ];

      assert.throws(() => {
        conn.encode(links);
      }, /not ready/i);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const caps = ProtocolCapabilities.withBinarySupport();
      const conn = new ProtocolConnection(caps);

      // Complete negotiation
      conn.handleCapabilities(
        ProtocolCapabilities.withBinarySupport().toJSON()
      );
      assert.strictEqual(conn.isReady(), true);

      // Reset
      conn.reset();
      assert.strictEqual(conn.state, ConnectionState.INITIAL);
      assert.strictEqual(conn.isReady(), false);
      assert.strictEqual(conn.getProtocol(), null);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Protocol Negotiation Integration', () => {
  it('should complete full handshake between client and server', () => {
    // Client initiates
    const clientCaps = ProtocolCapabilities.withBinarySupport();
    const clientConn = new ProtocolConnection(clientCaps);
    const clientMessage = clientConn.initiateNegotiation();

    // Server receives and responds
    const serverCaps = ProtocolCapabilities.withBinarySupport();
    const serverConn = new ProtocolConnection(serverCaps);
    const serverResult = serverConn.handleCapabilities(clientMessage);

    // Client receives result
    clientConn.handleNegotiationResult(serverResult);

    // Both should be ready
    assert.strictEqual(clientConn.isReady(), true);
    assert.strictEqual(serverConn.isReady(), true);

    // Both should agree on protocol
    assert.strictEqual(clientConn.getProtocol(), Protocol.BINARY);
    assert.strictEqual(serverConn.getProtocol(), Protocol.BINARY);

    // Both should be able to encode/decode
    const links = [
      {
        id: 42,
        source: { type: 'Int', value: 1 },
        target: { type: 'Int', value: 2 },
      },
    ];

    const clientEncoded = clientConn.encode(links);
    const serverDecoded = serverConn.decode(clientEncoded);
    assert.strictEqual(serverDecoded.length, 1);

    const serverEncoded = serverConn.encode(links);
    const clientDecoded = clientConn.decode(serverEncoded);
    assert.strictEqual(clientDecoded.length, 1);
  });

  it('should handle mixed capabilities gracefully', () => {
    // Client supports binary
    const clientCaps = ProtocolCapabilities.withBinarySupport();
    const clientConn = new ProtocolConnection(clientCaps);
    const clientMessage = clientConn.initiateNegotiation();

    // Server is text-only
    const serverCaps = ProtocolCapabilities.textOnly();
    const serverConn = new ProtocolConnection(serverCaps);
    const serverResult = serverConn.handleCapabilities(clientMessage);

    // Client receives result
    clientConn.handleNegotiationResult(serverResult);

    // Both should fall back to text
    assert.strictEqual(clientConn.getProtocol(), Protocol.TEXT);
    assert.strictEqual(serverConn.getProtocol(), Protocol.TEXT);
  });
});
