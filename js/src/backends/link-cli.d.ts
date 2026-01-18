/**
 * link-cli storage backend type definitions.
 */

import type {
  StorageBackend,
  BackendCapabilities,
  BackendStats,
  LinkCliBackendOptions,
} from './types.ts';
import type { Link, LinkId, LinkPattern } from '../types.ts';

/**
 * Extended options for LinkCliBackend.
 */
export interface LinkCliBackendExtendedOptions extends LinkCliBackendOptions {
  /**
   * Path to link-cli binary.
   * @default 'clink'
   */
  binaryPath?: string;
}

/**
 * Storage backend implementation using link-cli.
 *
 * Provides persistent storage via link-cli, communicating through
 * child processes using Links Notation format.
 *
 * @example
 * import { LinkCliBackend } from 'links-queue';
 *
 * const backend = new LinkCliBackend({
 *   path: './data/db.links',
 *   binaryPath: '/usr/local/bin/clink'
 * });
 *
 * await backend.connect();
 * const id = await backend.save({ id: 0, source: 1, target: 2 });
 * await backend.disconnect();
 */
export declare class LinkCliBackend implements StorageBackend {
  /**
   * Creates a new LinkCliBackend instance.
   * @param options - Configuration options
   */
  constructor(options: LinkCliBackendExtendedOptions);

  /**
   * Establishes connection to the link-cli backend.
   * Verifies that the link-cli binary is available.
   */
  connect(): Promise<void>;

  /**
   * Disconnects from the link-cli backend.
   */
  disconnect(): Promise<void>;

  /**
   * Checks if the backend is currently connected.
   */
  isConnected(): boolean;

  /**
   * Saves a link to storage.
   * @param link - The link to save
   * @returns The ID of the saved link
   */
  save(link: Link): Promise<LinkId>;

  /**
   * Loads a link by its ID.
   * @param id - The ID of the link to load
   * @returns The link if found, null otherwise
   */
  load(id: LinkId): Promise<Link | null>;

  /**
   * Deletes a link by its ID.
   * @param id - The ID of the link to delete
   * @returns True if the link was deleted
   */
  delete(id: LinkId): Promise<boolean>;

  /**
   * Queries links matching a pattern.
   * @param pattern - The pattern to match
   * @returns Array of matching links
   */
  query(pattern: LinkPattern): Promise<Link[]>;

  /**
   * Saves multiple links in a batch.
   * @param links - Array of links to save
   * @returns Array of IDs
   */
  saveBatch(links: readonly Link[]): Promise<LinkId[]>;

  /**
   * Deletes multiple links by their IDs.
   * @param ids - Array of IDs to delete
   * @returns Array of booleans indicating success
   */
  deleteBatch(ids: readonly LinkId[]): Promise<boolean[]>;

  /**
   * Returns the capabilities of this backend.
   */
  getCapabilities(): BackendCapabilities;

  /**
   * Returns statistics about the backend.
   */
  getStats(): BackendStats;
}
