/**
 * link-cli process management for links-queue.
 *
 * This module handles the lifecycle of link-cli child processes,
 * including spawning, communication via stdin/stdout, and graceful shutdown.
 *
 * @module backends/link-cli-process
 *
 * @see https://github.com/link-foundation/link-cli
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { setTimeout, clearTimeout } from 'node:timers';

/**
 * Process state enum.
 * @readonly
 * @enum {string}
 */
export const ProcessState = {
  /** Process not yet started */
  STOPPED: 'stopped',
  /** Process is starting up */
  STARTING: 'starting',
  /** Process is running and ready */
  RUNNING: 'running',
  /** Process is shutting down */
  STOPPING: 'stopping',
  /** Process has crashed */
  CRASHED: 'crashed',
};

/**
 * Default options for LinkCliProcess.
 * @type {Object}
 */
const DEFAULT_OPTIONS = {
  /** Path to link-cli binary */
  binaryPath: 'clink',
  /** Path to database file */
  dbPath: 'db.links',
  /** Whether to auto-restart on crash */
  autoRestart: true,
  /** Maximum restart attempts */
  maxRestarts: 3,
  /** Delay between restart attempts in ms */
  restartDelay: 1000,
  /** Timeout for operations in ms */
  operationTimeout: 30000,
  /** Enable verbose/trace output from link-cli */
  trace: false,
};

/**
 * Manages a link-cli child process.
 *
 * Handles spawning, communication, and lifecycle management of the
 * link-cli process. Each operation spawns a new process and waits
 * for completion (link-cli operates in command mode, not interactive).
 *
 * @extends EventEmitter
 *
 * @example
 * const process = new LinkCliProcess({
 *   dbPath: './data/db.links',
 *   binaryPath: 'clink'
 * });
 *
 * // Execute a query
 * const result = await process.execute('() ((1 1))');
 *
 * @fires LinkCliProcess#ready - When process is ready for operations
 * @fires LinkCliProcess#error - When an error occurs
 * @fires LinkCliProcess#exit - When process exits
 */
export class LinkCliProcess extends EventEmitter {
  /**
   * Creates a new LinkCliProcess instance.
   *
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.binaryPath='clink'] - Path to link-cli binary
   * @param {string} [options.dbPath='db.links'] - Path to database file
   * @param {boolean} [options.autoRestart=true] - Auto-restart on crash
   * @param {number} [options.maxRestarts=3] - Maximum restart attempts
   * @param {number} [options.restartDelay=1000] - Delay between restarts (ms)
   * @param {number} [options.operationTimeout=30000] - Operation timeout (ms)
   * @param {boolean} [options.trace=false] - Enable trace output
   */
  constructor(options = {}) {
    super();

    /** @private */
    this._options = { ...DEFAULT_OPTIONS, ...options };

    /** @private */
    this._state = ProcessState.STOPPED;

    /** @private */
    this._restartCount = 0;
  }

  /**
   * Gets the current process state.
   * @returns {string} Current state
   */
  get state() {
    return this._state;
  }

  /**
   * Gets the database path.
   * @returns {string} Database path
   */
  get dbPath() {
    return this._options.dbPath;
  }

  /**
   * Gets the binary path.
   * @returns {string} Binary path
   */
  get binaryPath() {
    return this._options.binaryPath;
  }

  /**
   * Checks if link-cli binary is available.
   *
   * @returns {Promise<boolean>} True if binary is available
   */
  // eslint-disable-next-line require-await
  async checkBinaryAvailable() {
    return new Promise((resolve) => {
      const proc = spawn(this._options.binaryPath, ['--help'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });

      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  /**
   * Executes a link-cli query and returns the result.
   *
   * link-cli operates in command mode - each operation spawns a new
   * process, executes the query, and returns the result.
   *
   * @param {string} query - The Links Notation query to execute
   * @param {Object} [options={}] - Execution options
   * @param {boolean} [options.changes=true] - Include changes in output
   * @param {boolean} [options.after=true] - Include state after changes
   * @param {boolean} [options.before=false] - Include state before changes
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   * @throws {Error} If execution fails or times out
   *
   * @example
   * // Create a link
   * const result = await process.execute('() ((1 2))');
   *
   * // Read all links
   * const links = await process.execute('((($i: $s $t)) (($i: $s $t)))');
   */
  execute(query, options = {}) {
    return new Promise((resolve, reject) => {
      const args = [
        '--db',
        this._options.dbPath,
        query,
        ...(options.changes !== false ? ['--changes'] : []),
        ...(options.after !== false ? ['--after'] : []),
        ...(options.before === true ? ['--before'] : []),
        ...(this._options.trace ? ['--trace'] : []),
      ];

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(this._options.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        reject(
          new Error(
            `Operation timed out after ${this._options.operationTimeout}ms`
          )
        );
      }, this._options.operationTimeout);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        this.emit('error', error);
        reject(new Error(`Failed to execute link-cli: ${error.message}`));
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) {
          return;
        }

        if (exitCode !== 0) {
          const errorMsg = stderr || `link-cli exited with code ${exitCode}`;
          reject(new Error(errorMsg));
          return;
        }

        resolve({ stdout, stderr, exitCode });
      });
    });
  }

  /**
   * Creates a link in the database.
   *
   * @param {number|string} source - Source reference
   * @param {number|string} target - Target reference
   * @returns {Promise<{id: number, source: number, target: number}|null>}
   *
   * @example
   * const link = await process.createLink(1, 2);
   * console.log(link); // { id: 1, source: 1, target: 2 }
   */
  async createLink(source, target) {
    const query = `() ((${source} ${target}))`;
    const result = await this.execute(query);

    // Parse the output to get the created link
    const created = this._parseChanges(result.stdout);
    if (created.length > 0) {
      return created[0];
    }
    return null;
  }

  /**
   * Reads all links matching a pattern.
   *
   * @param {Object} [pattern={}] - Pattern to match
   * @param {number|string} [pattern.id] - Link ID to match
   * @param {number|string} [pattern.source] - Source to match
   * @param {number|string} [pattern.target] - Target to match
   * @returns {Promise<Array<{id: number, source: number, target: number}>>}
   *
   * @example
   * // Read all links
   * const links = await process.readLinks();
   *
   * // Read links with specific source
   * const filtered = await process.readLinks({ source: 1 });
   */
  async readLinks(pattern = {}) {
    // Build the query based on pattern
    let query;
    if (pattern.id !== undefined) {
      // Specific ID lookup
      const s = pattern.source !== undefined ? pattern.source : '$s';
      const t = pattern.target !== undefined ? pattern.target : '$t';
      query = `(((${pattern.id}: ${s} ${t})) ((${pattern.id}: ${s} ${t})))`;
    } else if (pattern.source !== undefined || pattern.target !== undefined) {
      // Pattern-based query
      const s = pattern.source !== undefined ? pattern.source : '$s';
      const t = pattern.target !== undefined ? pattern.target : '$t';
      query = `((($i: ${s} ${t})) (($i: ${s} ${t})))`;
    } else {
      // Read all links
      query = '((($i: $s $t)) (($i: $s $t)))';
    }

    const result = await this.execute(query, { changes: true, after: false });

    // Parse the output to get the links
    return this._parseChanges(result.stdout);
  }

  /**
   * Deletes a link by its structure (source, target).
   *
   * @param {number|string} source - Source reference
   * @param {number|string} target - Target reference
   * @returns {Promise<boolean>} True if link was deleted
   *
   * @example
   * const deleted = await process.deleteLink(1, 2);
   */
  async deleteLink(source, target) {
    const query = `((${source} ${target})) ()`;
    const result = await this.execute(query);

    // Check if deletion happened
    const deleted = this._parseChanges(result.stdout);
    return deleted.length > 0;
  }

  /**
   * Deletes a link by its ID.
   *
   * @param {number|string} id - Link ID
   * @returns {Promise<boolean>} True if link was deleted
   *
   * @example
   * const deleted = await process.deleteLinkById(1);
   */
  async deleteLinkById(id) {
    // First, read the link to get its source and target
    const links = await this.readLinks({ id });
    if (links.length === 0) {
      return false;
    }

    const link = links[0];
    return this.deleteLink(link.source, link.target);
  }

  /**
   * Parses link-cli output to extract links.
   *
   * @private
   * @param {string} output - Raw output from link-cli
   * @returns {Array<{id: number, source: number, target: number}>}
   */
  _parseChanges(output) {
    const links = [];
    const trimmed = output.trim();

    if (!trimmed) {
      return links;
    }

    // Parse Links Notation format: ((id: source target) ...)
    // Match patterns like (1: 1 2) or (1 2)
    const linkPattern = /\((\d+):\s*(\d+)\s+(\d+)\)/g;
    let match;

    while ((match = linkPattern.exec(trimmed)) !== null) {
      links.push({
        id: parseInt(match[1], 10),
        source: parseInt(match[2], 10),
        target: parseInt(match[3], 10),
      });
    }

    // Also try to match simple format (source target) when id is implicit
    // This is used in --changes output
    const simplePattern = /\((\d+)\s+(\d+)\)/g;
    while ((match = simplePattern.exec(trimmed)) !== null) {
      // Check if this wasn't already matched as part of id:source target
      const fullCheck = new RegExp(`\\(\\d+:\\s*${match[1]}\\s+${match[2]}\\)`);
      if (!fullCheck.test(trimmed)) {
        // For simple format without ID, we'll need context to determine ID
        // For now, skip these as they're typically part of the query, not results
      }
    }

    return links;
  }
}
