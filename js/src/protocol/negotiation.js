/**
 * Protocol negotiation for Links Queue communication.
 *
 * This module provides mechanisms for negotiating between text and binary
 * Links Notation protocols. It allows clients and servers to agree on the
 * most efficient protocol based on their capabilities.
 *
 * @module protocol/negotiation
 */

import { BinaryNotation } from './binary-notation.js';

// =============================================================================
// Protocol Constants
// =============================================================================

/**
 * Supported protocol types.
 * @readonly
 * @enum {string}
 */
export const Protocol = Object.freeze({
  /** Text-based Links Notation */
  TEXT: 'text/links-notation',
  /** Binary Links Notation */
  BINARY: 'binary/links-notation',
});

/**
 * Protocol versions.
 * @readonly
 * @enum {string}
 */
export const ProtocolVersion = Object.freeze({
  /** Binary notation version 1.0 */
  BINARY_V1: '1.0',
  /** Text notation (unversioned) */
  TEXT_V1: '1.0',
});

/**
 * Compression algorithms supported.
 * @readonly
 * @enum {string}
 */
export const CompressionAlgorithm = Object.freeze({
  /** No compression */
  NONE: 'none',
  /** Zstandard compression */
  ZSTD: 'zstd',
  /** LZ4 compression */
  LZ4: 'lz4',
});

// =============================================================================
// Capabilities
// =============================================================================

/**
 * Represents protocol capabilities of a client or server.
 */
export class ProtocolCapabilities {
  /**
   * Creates a new ProtocolCapabilities instance.
   *
   * @param {Object} [options] - Capability options
   * @param {string[]} [options.protocols] - Supported protocols
   * @param {string} [options.preferredProtocol] - Preferred protocol
   * @param {string} [options.binaryVersion] - Binary protocol version
   * @param {string[]} [options.compression] - Supported compression algorithms
   * @param {number} [options.maxMessageSize] - Maximum message size in bytes
   */
  constructor(options = {}) {
    /** @type {string[]} */
    this.protocols = options.protocols || [Protocol.TEXT];

    /** @type {string} */
    this.preferredProtocol = options.preferredProtocol || Protocol.TEXT;

    /** @type {string|null} */
    this.binaryVersion = options.binaryVersion || null;

    /** @type {string[]} */
    this.compression = options.compression || [CompressionAlgorithm.NONE];

    /** @type {number} */
    this.maxMessageSize = options.maxMessageSize || 16 * 1024 * 1024; // 16 MB default
  }

  /**
   * Creates capabilities with full binary support.
   *
   * @param {Object} [options] - Additional options
   * @returns {ProtocolCapabilities} Capabilities with binary support
   */
  static withBinarySupport(options = {}) {
    return new ProtocolCapabilities({
      protocols: [Protocol.BINARY, Protocol.TEXT],
      preferredProtocol: Protocol.BINARY,
      binaryVersion: ProtocolVersion.BINARY_V1,
      compression: options.compression || [CompressionAlgorithm.NONE],
      maxMessageSize: options.maxMessageSize || 16 * 1024 * 1024,
    });
  }

  /**
   * Creates capabilities for text-only mode.
   *
   * @param {Object} [options] - Additional options
   * @returns {ProtocolCapabilities} Text-only capabilities
   */
  static textOnly(options = {}) {
    return new ProtocolCapabilities({
      protocols: [Protocol.TEXT],
      preferredProtocol: Protocol.TEXT,
      binaryVersion: null,
      compression: [CompressionAlgorithm.NONE],
      maxMessageSize: options.maxMessageSize || 16 * 1024 * 1024,
    });
  }

  /**
   * Checks if binary protocol is supported.
   *
   * @returns {boolean} True if binary protocol is supported
   */
  supportsBinary() {
    return this.protocols.includes(Protocol.BINARY);
  }

  /**
   * Checks if a specific compression algorithm is supported.
   *
   * @param {string} algorithm - Compression algorithm to check
   * @returns {boolean} True if algorithm is supported
   */
  supportsCompression(algorithm) {
    return this.compression.includes(algorithm);
  }

  /**
   * Converts to JSON representation.
   *
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      type: 'capabilities',
      protocols: this.protocols,
      preferredProtocol: this.preferredProtocol,
      binaryVersion: this.binaryVersion,
      compression: this.compression,
      maxMessageSize: this.maxMessageSize,
    };
  }

  /**
   * Creates from JSON representation.
   *
   * @param {Object} json - JSON object
   * @returns {ProtocolCapabilities} Capabilities instance
   */
  static fromJSON(json) {
    return new ProtocolCapabilities({
      protocols: json.protocols,
      preferredProtocol: json.preferredProtocol,
      binaryVersion: json.binaryVersion,
      compression: json.compression,
      maxMessageSize: json.maxMessageSize,
    });
  }
}

// =============================================================================
// Negotiation Result
// =============================================================================

/**
 * Result of protocol negotiation.
 */
export class NegotiationResult {
  /**
   * Creates a new NegotiationResult.
   *
   * @param {Object} options - Result options
   * @param {string} options.protocol - Selected protocol
   * @param {string|null} [options.version] - Protocol version
   * @param {string|null} [options.compression] - Selected compression algorithm
   * @param {number} [options.maxMessageSize] - Agreed max message size
   */
  constructor(options) {
    /** @type {string} */
    this.protocol = options.protocol;

    /** @type {string|null} */
    this.version = options.version || null;

    /** @type {string|null} */
    this.compression = options.compression || null;

    /** @type {number} */
    this.maxMessageSize = options.maxMessageSize || 16 * 1024 * 1024;
  }

  /**
   * Checks if binary protocol was selected.
   *
   * @returns {boolean} True if binary protocol
   */
  isBinary() {
    return this.protocol === Protocol.BINARY;
  }

  /**
   * Checks if text protocol was selected.
   *
   * @returns {boolean} True if text protocol
   */
  isText() {
    return this.protocol === Protocol.TEXT;
  }

  /**
   * Converts to JSON representation.
   *
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      type: 'negotiation_result',
      protocol: this.protocol,
      version: this.version,
      compression: this.compression,
      maxMessageSize: this.maxMessageSize,
    };
  }

  /**
   * Creates from JSON representation.
   *
   * @param {Object} json - JSON object
   * @returns {NegotiationResult} Result instance
   */
  static fromJSON(json) {
    return new NegotiationResult({
      protocol: json.protocol,
      version: json.version,
      compression: json.compression,
      maxMessageSize: json.maxMessageSize,
    });
  }
}

// =============================================================================
// Protocol Negotiator
// =============================================================================

/**
 * Handles protocol negotiation between client and server.
 */
export class ProtocolNegotiator {
  /**
   * Creates a new ProtocolNegotiator.
   *
   * @param {ProtocolCapabilities} localCapabilities - Local capabilities
   */
  constructor(localCapabilities) {
    /** @type {ProtocolCapabilities} */
    this.localCapabilities = localCapabilities;

    /** @type {NegotiationResult|null} */
    this.negotiatedResult = null;
  }

  /**
   * Negotiates protocol with remote capabilities.
   *
   * Both sides prefer binary if available, falling back to text.
   *
   * @param {ProtocolCapabilities} remoteCapabilities - Remote capabilities
   * @returns {NegotiationResult} Negotiation result
   */
  negotiate(remoteCapabilities) {
    // Find common protocols
    const commonProtocols = this.localCapabilities.protocols.filter((p) =>
      remoteCapabilities.protocols.includes(p)
    );

    if (commonProtocols.length === 0) {
      // No common protocols - fall back to text
      this.negotiatedResult = new NegotiationResult({
        protocol: Protocol.TEXT,
        version: null,
        compression: null,
        maxMessageSize: Math.min(
          this.localCapabilities.maxMessageSize,
          remoteCapabilities.maxMessageSize
        ),
      });
      return this.negotiatedResult;
    }

    // Prefer binary if both support it
    let selectedProtocol;
    if (commonProtocols.includes(Protocol.BINARY)) {
      selectedProtocol = Protocol.BINARY;
    } else {
      selectedProtocol = Protocol.TEXT;
    }

    // Find common compression (prefer more efficient algorithms)
    let selectedCompression = CompressionAlgorithm.NONE;
    const compressionPreference = [
      CompressionAlgorithm.ZSTD,
      CompressionAlgorithm.LZ4,
      CompressionAlgorithm.NONE,
    ];

    for (const comp of compressionPreference) {
      if (
        this.localCapabilities.supportsCompression(comp) &&
        remoteCapabilities.supportsCompression(comp)
      ) {
        selectedCompression = comp;
        break;
      }
    }

    // Determine version
    let version = null;
    if (selectedProtocol === Protocol.BINARY) {
      version =
        this.localCapabilities.binaryVersion ||
        remoteCapabilities.binaryVersion ||
        ProtocolVersion.BINARY_V1;
    }

    this.negotiatedResult = new NegotiationResult({
      protocol: selectedProtocol,
      version,
      compression: selectedCompression,
      maxMessageSize: Math.min(
        this.localCapabilities.maxMessageSize,
        remoteCapabilities.maxMessageSize
      ),
    });

    return this.negotiatedResult;
  }

  /**
   * Gets the current negotiation result.
   *
   * @returns {NegotiationResult|null} Current result or null if not negotiated
   */
  getResult() {
    return this.negotiatedResult;
  }

  /**
   * Resets negotiation state.
   */
  reset() {
    this.negotiatedResult = null;
  }
}

// =============================================================================
// Protocol Codec
// =============================================================================

/**
 * Encodes and decodes messages based on negotiated protocol.
 */
export class ProtocolCodec {
  /**
   * Creates a new ProtocolCodec.
   *
   * @param {NegotiationResult} [negotiationResult] - Negotiation result
   */
  constructor(negotiationResult = null) {
    /** @type {NegotiationResult|null} */
    this.negotiationResult = negotiationResult;
  }

  /**
   * Sets the negotiation result.
   *
   * @param {NegotiationResult} result - Negotiation result
   */
  setNegotiationResult(result) {
    this.negotiationResult = result;
  }

  /**
   * Checks if codec is configured for binary.
   *
   * @returns {boolean} True if binary mode
   */
  isBinaryMode() {
    return this.negotiationResult?.isBinary() ?? false;
  }

  /**
   * Encodes links to wire format.
   *
   * @param {import('../index.js').Link[]} links - Links to encode
   * @returns {Uint8Array|string} Encoded data
   */
  encode(links) {
    if (this.isBinaryMode()) {
      return BinaryNotation.encode(links);
    }
    // Text mode - return stringified links
    // This would use LinksNotation.stringify in a full implementation
    return JSON.stringify(links);
  }

  /**
   * Decodes wire format to links.
   *
   * @param {Uint8Array|string} data - Data to decode
   * @returns {import('../index.js').Link[]} Decoded links
   */
  decode(data) {
    // Auto-detect binary vs text
    if (data instanceof Uint8Array) {
      if (BinaryNotation.isBinary(data)) {
        return BinaryNotation.decode(data);
      }
      // Try to decode as UTF-8 text
      const text = new TextDecoder().decode(data);
      return JSON.parse(text);
    }

    if (typeof data === 'string') {
      // Text mode
      return JSON.parse(data);
    }

    throw new Error('Invalid data type for decoding');
  }

  /**
   * Detects the protocol of incoming data.
   *
   * @param {Uint8Array|string} data - Data to check
   * @returns {string} Detected protocol (Protocol.BINARY or Protocol.TEXT)
   */
  static detectProtocol(data) {
    if (data instanceof Uint8Array) {
      if (BinaryNotation.isBinary(data)) {
        return Protocol.BINARY;
      }
    }
    return Protocol.TEXT;
  }
}

// =============================================================================
// Connection State Machine
// =============================================================================

/**
 * Connection states for protocol negotiation.
 * @readonly
 * @enum {string}
 */
export const ConnectionState = Object.freeze({
  /** Initial state, no negotiation started */
  INITIAL: 'initial',
  /** Waiting for remote capabilities */
  AWAITING_CAPABILITIES: 'awaiting_capabilities',
  /** Negotiation complete, ready for messages */
  NEGOTIATED: 'negotiated',
  /** Negotiation failed */
  FAILED: 'failed',
});

/**
 * Manages connection state for protocol negotiation.
 */
export class ProtocolConnection {
  /**
   * Creates a new ProtocolConnection.
   *
   * @param {ProtocolCapabilities} localCapabilities - Local capabilities
   */
  constructor(localCapabilities) {
    /** @type {ProtocolCapabilities} */
    this.localCapabilities = localCapabilities;

    /** @type {ProtocolNegotiator} */
    this.negotiator = new ProtocolNegotiator(localCapabilities);

    /** @type {ProtocolCodec} */
    this.codec = new ProtocolCodec();

    /** @type {string} */
    this.state = ConnectionState.INITIAL;

    /** @type {Error|null} */
    this.lastError = null;
  }

  /**
   * Initiates protocol negotiation (client side).
   *
   * @returns {Object} Capabilities message to send
   */
  initiateNegotiation() {
    this.state = ConnectionState.AWAITING_CAPABILITIES;
    return this.localCapabilities.toJSON();
  }

  /**
   * Handles incoming capabilities message.
   *
   * @param {Object} message - Capabilities message
   * @returns {Object} Response message (negotiation result or capabilities)
   */
  handleCapabilities(message) {
    try {
      const remoteCapabilities = ProtocolCapabilities.fromJSON(message);
      const result = this.negotiator.negotiate(remoteCapabilities);

      this.codec.setNegotiationResult(result);
      this.state = ConnectionState.NEGOTIATED;

      return result.toJSON();
    } catch (error) {
      this.state = ConnectionState.FAILED;
      this.lastError = error;
      throw error;
    }
  }

  /**
   * Handles incoming negotiation result message.
   *
   * @param {Object} message - Negotiation result message
   */
  handleNegotiationResult(message) {
    try {
      const result = NegotiationResult.fromJSON(message);
      this.codec.setNegotiationResult(result);
      // Also update the negotiator's result so getProtocol() works
      this.negotiator.negotiatedResult = result;
      this.state = ConnectionState.NEGOTIATED;
    } catch (error) {
      this.state = ConnectionState.FAILED;
      this.lastError = error;
      throw error;
    }
  }

  /**
   * Checks if connection is ready for messages.
   *
   * @returns {boolean} True if negotiation complete
   */
  isReady() {
    return this.state === ConnectionState.NEGOTIATED;
  }

  /**
   * Gets the current protocol.
   *
   * @returns {string|null} Current protocol or null if not negotiated
   */
  getProtocol() {
    return this.negotiator.getResult()?.protocol ?? null;
  }

  /**
   * Encodes a message for sending.
   *
   * @param {import('../index.js').Link[]} links - Links to encode
   * @returns {Uint8Array|string} Encoded data
   */
  encode(links) {
    if (!this.isReady()) {
      throw new Error('Connection not ready: negotiation not complete');
    }
    return this.codec.encode(links);
  }

  /**
   * Decodes received data.
   *
   * @param {Uint8Array|string} data - Data to decode
   * @returns {import('../index.js').Link[]} Decoded links
   */
  decode(data) {
    return this.codec.decode(data);
  }

  /**
   * Resets the connection state.
   */
  reset() {
    this.negotiator.reset();
    this.codec = new ProtocolCodec();
    this.state = ConnectionState.INITIAL;
    this.lastError = null;
  }
}
