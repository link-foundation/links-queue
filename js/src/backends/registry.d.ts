/**
 * Backend registry type definitions for links-queue.
 */

import type {
  StorageBackend,
  BackendOptions,
  BackendConstructor,
  BackendFactory,
  BackendCapabilities,
  BackendStats,
  MemoryBackendOptions,
} from './types.ts';
import type { Link, LinkId, LinkPattern } from '../types.ts';

/**
 * Memory backend adapter that wraps MemoryLinkStore with StorageBackend interface.
 */
export declare class MemoryBackendAdapter implements StorageBackend {
  constructor(options?: MemoryBackendOptions);

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  save(link: Link): Promise<LinkId>;
  load(id: LinkId): Promise<Link | null>;
  delete(id: LinkId): Promise<boolean>;
  query(pattern: LinkPattern): Promise<Link[]>;

  saveBatch(links: readonly Link[]): Promise<LinkId[]>;
  deleteBatch(ids: readonly LinkId[]): Promise<boolean[]>;

  getCapabilities(): BackendCapabilities;
  getStats(): BackendStats;

  clear(): Promise<void>;
}

/**
 * Backend registry interface.
 */
export interface BackendRegistryInterface {
  /**
   * Registers a backend implementation.
   */
  register(name: string, backend: BackendConstructor | BackendFactory): void;

  /**
   * Unregisters a backend implementation.
   */
  unregister(name: string): boolean;

  /**
   * Checks if a backend is registered.
   */
  has(name: string): boolean;

  /**
   * Creates a backend instance from configuration.
   */
  create(config: BackendOptions): StorageBackend;

  /**
   * Lists all registered backend types.
   */
  listTypes(): string[];

  /**
   * Resets the registry to default state.
   */
  reset(): void;
}

/**
 * Singleton backend registry instance.
 */
export declare const BackendRegistry: BackendRegistryInterface;
