/**
 * link-cli process management type definitions.
 */

import { EventEmitter } from 'node:events';

/**
 * Process state values.
 */
export declare const ProcessState: {
  readonly STOPPED: 'stopped';
  readonly STARTING: 'starting';
  readonly RUNNING: 'running';
  readonly STOPPING: 'stopping';
  readonly CRASHED: 'crashed';
};

export type ProcessStateValue =
  (typeof ProcessState)[keyof typeof ProcessState];

/**
 * Options for LinkCliProcess.
 */
export interface LinkCliProcessOptions {
  /**
   * Path to link-cli binary.
   * @default 'clink'
   */
  binaryPath?: string;

  /**
   * Path to database file.
   * @default 'db.links'
   */
  dbPath?: string;

  /**
   * Whether to auto-restart on crash.
   * @default true
   */
  autoRestart?: boolean;

  /**
   * Maximum restart attempts.
   * @default 3
   */
  maxRestarts?: number;

  /**
   * Delay between restart attempts in ms.
   * @default 1000
   */
  restartDelay?: number;

  /**
   * Timeout for operations in ms.
   * @default 30000
   */
  operationTimeout?: number;

  /**
   * Enable trace/verbose output.
   * @default false
   */
  trace?: boolean;
}

/**
 * Execution options for queries.
 */
export interface ExecuteOptions {
  /**
   * Include changes in output.
   * @default true
   */
  changes?: boolean;

  /**
   * Include state after changes.
   * @default true
   */
  after?: boolean;

  /**
   * Include state before changes.
   * @default false
   */
  before?: boolean;
}

/**
 * Result from executing a link-cli query.
 */
export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * A parsed link from link-cli output.
 */
export interface ParsedLink {
  id: number;
  source: number;
  target: number;
}

/**
 * Pattern for querying links.
 */
export interface LinkQueryPattern {
  id?: number | string;
  source?: number | string;
  target?: number | string;
}

/**
 * Manages a link-cli child process.
 */
export declare class LinkCliProcess extends EventEmitter {
  constructor(options?: LinkCliProcessOptions);

  /**
   * Gets the current process state.
   */
  get state(): ProcessStateValue;

  /**
   * Gets the database path.
   */
  get dbPath(): string;

  /**
   * Gets the binary path.
   */
  get binaryPath(): string;

  /**
   * Checks if link-cli binary is available.
   */
  checkBinaryAvailable(): Promise<boolean>;

  /**
   * Executes a link-cli query and returns the result.
   */
  execute(query: string, options?: ExecuteOptions): Promise<ExecuteResult>;

  /**
   * Creates a link in the database.
   */
  createLink(
    source: number | string,
    target: number | string
  ): Promise<ParsedLink | null>;

  /**
   * Reads all links matching a pattern.
   */
  readLinks(pattern?: LinkQueryPattern): Promise<ParsedLink[]>;

  /**
   * Deletes a link by its structure.
   */
  deleteLink(
    source: number | string,
    target: number | string
  ): Promise<boolean>;

  /**
   * Deletes a link by its ID.
   */
  deleteLinkById(id: number | string): Promise<boolean>;
}
