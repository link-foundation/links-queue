/**
 * links-queue - Core type definitions
 *
 * This module exports the Link and LinkStore interfaces that form
 * the API contract for all implementations.
 */

// =============================================================================
// ID and Reference Types
// =============================================================================

/**
 * A link identifier. Can be a number, bigint, or string.
 */
export type LinkId = number | bigint | string;

/**
 * A reference to a link, which can be an ID or a nested Link object.
 */
export type LinkRef = LinkId | Link;

// =============================================================================
// Link Interface
// =============================================================================

/**
 * Represents a link (associative data structure) connecting source to target.
 */
export interface Link {
  readonly id: LinkId;
  readonly source: LinkRef;
  readonly target: LinkRef;
  readonly values?: readonly LinkRef[];
}

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Special value indicating "any" match in pattern queries.
 */
export declare const Any: unique symbol;
export type AnyType = typeof Any;

/**
 * Pattern for matching links in queries.
 */
export interface LinkPattern {
  readonly id?: LinkId | AnyType;
  readonly source?: LinkRef | AnyType;
  readonly target?: LinkRef | AnyType;
}

// =============================================================================
// LinkStore Interface
// =============================================================================

/**
 * Interface for link storage operations.
 */
export interface LinkStore {
  create(source: LinkRef, target: LinkRef): Promise<Link>;
  createWithValues(
    source: LinkRef,
    target: LinkRef,
    values: readonly LinkRef[]
  ): Promise<Link>;
  get(id: LinkId): Promise<Link | null>;
  exists(id: LinkId): Promise<boolean>;
  find(pattern: LinkPattern): Promise<Link[]>;
  count(pattern?: LinkPattern): Promise<number>;
  update(id: LinkId, source: LinkRef, target: LinkRef): Promise<Link>;
  delete(id: LinkId): Promise<boolean>;
  deleteMatching(pattern: LinkPattern): Promise<number>;
  iterate(pattern?: LinkPattern): AsyncIterable<Link>;
}

// =============================================================================
// Utility Types
// =============================================================================

export type LinkIdOf<L extends Link> = L['id'];

export interface MutableLink {
  id: LinkId;
  source: LinkRef;
  target: LinkRef;
  values?: LinkRef[];
}

export interface CreateLinkOptions {
  source: LinkRef;
  target: LinkRef;
  values?: LinkRef[];
}

export type LinkResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Checks if a value is a Link object.
 */
export declare const isLink: (value: unknown) => value is Link;

/**
 * Checks if a value is a valid LinkId.
 */
export declare const isLinkId: (value: unknown) => value is LinkId;

/**
 * Checks if a value is a valid LinkRef.
 */
export declare const isLinkRef: (value: unknown) => value is LinkRef;

/**
 * Extracts the LinkId from a LinkRef.
 */
export declare const getLinkId: (ref: LinkRef) => LinkId;

/**
 * Creates a Link object from source and target references.
 */
export declare const createLink: (
  id: LinkId,
  source: LinkRef,
  target: LinkRef,
  values?: LinkRef[]
) => Link;

/**
 * Checks if a pattern matches a link.
 */
export declare const matchesPattern: (
  link: Link,
  pattern: LinkPattern
) => boolean;

// =============================================================================
// Deprecated exports (keep for backward compatibility)
// =============================================================================

/**
 * @deprecated Use the new Link interface
 */
export declare const add: (a: number, b: number) => number;

/**
 * @deprecated Use the new Link interface
 */
export declare const multiply: (a: number, b: number) => number;

/**
 * @deprecated Will be removed in future versions
 */
export declare const delay: (ms: number) => Promise<void>;

// =============================================================================
// Backend Exports
// =============================================================================

export { MemoryLinkStore } from './backends/memory.d.ts';

// Storage backend interface and registry
export type {
  StorageBackend,
  BackendCapabilities,
  BackendStats,
  OperationStats,
  DurabilityLevel,
  BackendOptions,
  MemoryBackendOptions,
  LinkCliBackendOptions,
  CustomBackendOptions,
  BackendConstructor,
  BackendFactory,
} from './backends/types.ts';

export {
  BackendRegistry,
  MemoryBackendAdapter,
} from './backends/registry.d.ts';

export type { BackendRegistryInterface } from './backends/registry.d.ts';

// link-cli backend for persistent storage
export { LinkCliBackend } from './backends/link-cli.d.ts';
export type { LinkCliBackendExtendedOptions } from './backends/link-cli.d.ts';
export {
  LinkCliProcess,
  ProcessState,
  ProcessStateValue,
  LinkCliProcessOptions,
  ExecuteOptions,
  ExecuteResult,
  ParsedLink,
  LinkQueryPattern,
} from './backends/link-cli-process.d.ts';

// =============================================================================
// Queue Exports
// =============================================================================

export {
  EnqueueResult,
  QueueStats,
  QueueOptions,
  Queue,
  QueueInfo,
  QueueManager,
  QueueErrorCode,
  QueueError,
  QueueHandler,
  QueueSubscription,
} from './queue/index.d.ts';

// =============================================================================
// Protocol Exports
// =============================================================================

export {
  LinksNotation,
  NotationParser,
  NotationStreamParser,
  NotationParseError,
  ParseOptions,
  StringifyOptions,
  ParserOptions,
  StreamParserOptions,
  ParseLocation,
  StreamParserEvent,
  StreamParserHandler,
} from './protocol/notation.d.ts';

export {
  Message,
  MessageBuilder,
  RequestType,
  ResponseStatus,
  ErrorCode,
  RequestTypeValue,
  ResponseStatusValue,
  ErrorCodeValue,
  MessageData,
  ErrorInfo,
  EnqueueOptions,
  createOkResponse,
  createErrorResponse,
  createEnqueueRequest,
  createDequeueRequest,
  createPeekRequest,
  createAckRequest,
  createRejectRequest,
  createQueryRequest,
  createGetStatsRequest,
  createListQueuesRequest,
  createCreateQueueRequest,
  createDeleteQueueRequest,
} from './protocol/messages.d.ts';

// =============================================================================
// Cluster Exports
// =============================================================================

export {
  // Status types
  NodeStatus,
  // Node interface
  ClusterNode,
  // Event types
  ClusterEventType,
  NodeJoinedHandler,
  NodeLeftHandler,
  NodeSuspectHandler,
  LeaderChangedHandler,
  RebalanceStartedHandler,
  RebalanceCompletedHandler,
  // Coordinator interface
  ClusterCoordinator,
  // Replication types
  SyncMode,
  ReplicationManager,
  // Configuration types
  DiscoveryMethod,
  ReplicationConfig,
  ClusterConfig,
  // Statistics
  ClusterStats,
  // Error types
  ClusterErrorCode,
  ClusterError,
} from './cluster/index.d.ts';
