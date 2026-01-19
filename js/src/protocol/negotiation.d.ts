/**
 * Protocol negotiation for Links Queue communication.
 */

import { EncodedLink } from './binary-notation.js';

/**
 * Supported protocol types.
 */
export const Protocol: {
  readonly TEXT: 'text/links-notation';
  readonly BINARY: 'binary/links-notation';
};

export type ProtocolType = (typeof Protocol)[keyof typeof Protocol];

/**
 * Protocol versions.
 */
export const ProtocolVersion: {
  readonly BINARY_V1: '1.0';
  readonly TEXT_V1: '1.0';
};

export type ProtocolVersionType =
  (typeof ProtocolVersion)[keyof typeof ProtocolVersion];

/**
 * Compression algorithms supported.
 */
export const CompressionAlgorithm: {
  readonly NONE: 'none';
  readonly ZSTD: 'zstd';
  readonly LZ4: 'lz4';
};

export type CompressionAlgorithmType =
  (typeof CompressionAlgorithm)[keyof typeof CompressionAlgorithm];

/**
 * Options for creating ProtocolCapabilities.
 */
export interface ProtocolCapabilitiesOptions {
  protocols?: ProtocolType[];
  preferredProtocol?: ProtocolType;
  binaryVersion?: string | null;
  compression?: CompressionAlgorithmType[];
  maxMessageSize?: number;
}

/**
 * Represents protocol capabilities of a client or server.
 */
export class ProtocolCapabilities {
  readonly protocols: ProtocolType[];
  readonly preferredProtocol: ProtocolType;
  readonly binaryVersion: string | null;
  readonly compression: CompressionAlgorithmType[];
  readonly maxMessageSize: number;

  constructor(options?: ProtocolCapabilitiesOptions);

  /**
   * Creates capabilities with full binary support.
   */
  static withBinarySupport(
    options?: Pick<ProtocolCapabilitiesOptions, 'compression' | 'maxMessageSize'>
  ): ProtocolCapabilities;

  /**
   * Creates capabilities for text-only mode.
   */
  static textOnly(
    options?: Pick<ProtocolCapabilitiesOptions, 'maxMessageSize'>
  ): ProtocolCapabilities;

  /**
   * Checks if binary protocol is supported.
   */
  supportsBinary(): boolean;

  /**
   * Checks if a specific compression algorithm is supported.
   */
  supportsCompression(algorithm: CompressionAlgorithmType): boolean;

  /**
   * Converts to JSON representation.
   */
  toJSON(): CapabilitiesJSON;

  /**
   * Creates from JSON representation.
   */
  static fromJSON(json: CapabilitiesJSON): ProtocolCapabilities;
}

/**
 * JSON representation of capabilities.
 */
export interface CapabilitiesJSON {
  type: 'capabilities';
  protocols: ProtocolType[];
  preferredProtocol: ProtocolType;
  binaryVersion: string | null;
  compression: CompressionAlgorithmType[];
  maxMessageSize: number;
}

/**
 * Options for creating NegotiationResult.
 */
export interface NegotiationResultOptions {
  protocol: ProtocolType;
  version?: string | null;
  compression?: CompressionAlgorithmType | null;
  maxMessageSize?: number;
}

/**
 * Result of protocol negotiation.
 */
export class NegotiationResult {
  readonly protocol: ProtocolType;
  readonly version: string | null;
  readonly compression: CompressionAlgorithmType | null;
  readonly maxMessageSize: number;

  constructor(options: NegotiationResultOptions);

  /**
   * Checks if binary protocol was selected.
   */
  isBinary(): boolean;

  /**
   * Checks if text protocol was selected.
   */
  isText(): boolean;

  /**
   * Converts to JSON representation.
   */
  toJSON(): NegotiationResultJSON;

  /**
   * Creates from JSON representation.
   */
  static fromJSON(json: NegotiationResultJSON): NegotiationResult;
}

/**
 * JSON representation of negotiation result.
 */
export interface NegotiationResultJSON {
  type: 'negotiation_result';
  protocol: ProtocolType;
  version: string | null;
  compression: CompressionAlgorithmType | null;
  maxMessageSize: number;
}

/**
 * Handles protocol negotiation between client and server.
 */
export class ProtocolNegotiator {
  readonly localCapabilities: ProtocolCapabilities;
  negotiatedResult: NegotiationResult | null;

  constructor(localCapabilities: ProtocolCapabilities);

  /**
   * Negotiates protocol with remote capabilities.
   */
  negotiate(remoteCapabilities: ProtocolCapabilities): NegotiationResult;

  /**
   * Gets the current negotiation result.
   */
  getResult(): NegotiationResult | null;

  /**
   * Resets negotiation state.
   */
  reset(): void;
}

/**
 * Encodes and decodes messages based on negotiated protocol.
 */
export class ProtocolCodec {
  negotiationResult: NegotiationResult | null;

  constructor(negotiationResult?: NegotiationResult | null);

  /**
   * Sets the negotiation result.
   */
  setNegotiationResult(result: NegotiationResult): void;

  /**
   * Checks if codec is configured for binary.
   */
  isBinaryMode(): boolean;

  /**
   * Encodes links to wire format.
   */
  encode(links: EncodedLink[]): Uint8Array | string;

  /**
   * Decodes wire format to links.
   */
  decode(data: Uint8Array | string): EncodedLink[];

  /**
   * Detects the protocol of incoming data.
   */
  static detectProtocol(data: Uint8Array | string): ProtocolType;
}

/**
 * Connection states for protocol negotiation.
 */
export const ConnectionState: {
  readonly INITIAL: 'initial';
  readonly AWAITING_CAPABILITIES: 'awaiting_capabilities';
  readonly NEGOTIATED: 'negotiated';
  readonly FAILED: 'failed';
};

export type ConnectionStateType =
  (typeof ConnectionState)[keyof typeof ConnectionState];

/**
 * Manages connection state for protocol negotiation.
 */
export class ProtocolConnection {
  readonly localCapabilities: ProtocolCapabilities;
  readonly negotiator: ProtocolNegotiator;
  readonly codec: ProtocolCodec;
  state: ConnectionStateType;
  lastError: Error | null;

  constructor(localCapabilities: ProtocolCapabilities);

  /**
   * Initiates protocol negotiation (client side).
   */
  initiateNegotiation(): CapabilitiesJSON;

  /**
   * Handles incoming capabilities message.
   */
  handleCapabilities(message: CapabilitiesJSON): NegotiationResultJSON;

  /**
   * Handles incoming negotiation result message.
   */
  handleNegotiationResult(message: NegotiationResultJSON): void;

  /**
   * Checks if connection is ready for messages.
   */
  isReady(): boolean;

  /**
   * Gets the current protocol.
   */
  getProtocol(): ProtocolType | null;

  /**
   * Encodes a message for sending.
   */
  encode(links: EncodedLink[]): Uint8Array | string;

  /**
   * Decodes received data.
   */
  decode(data: Uint8Array | string): EncodedLink[];

  /**
   * Resets the connection state.
   */
  reset(): void;
}
