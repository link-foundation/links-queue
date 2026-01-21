/**
 * Structured logging module for links-queue.
 *
 * Provides structured logging with JSON format support, configurable log levels,
 * correlation IDs for request tracing, and log rotation support.
 *
 * @module observability/logger
 *
 * @see REQUIREMENTS.md - REQ-OBS-010 through REQ-OBS-012
 */

import { createWriteStream } from 'node:fs';
import { stat, rename, readdir, unlink } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Log levels with numeric severity.
 * Higher numbers indicate more severe levels.
 */
export const LogLevel = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
});

/**
 * Safely gets an environment variable value.
 * Returns undefined if access is denied (e.g., Deno without --allow-env).
 *
 * @param {string} name - Environment variable name
 * @returns {string|undefined} Value or undefined
 */
const safeGetEnv = (name) => {
  try {
    return process.env[name];
  } catch {
    // Deno without --allow-env will throw
    return undefined;
  }
};

/**
 * Log level names for output.
 */
const LOG_LEVEL_NAMES = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

/**
 * Parses a log level string to its numeric value.
 *
 * @param {string|number} level - Log level
 * @returns {number} Numeric log level
 */
const parseLogLevel = (level) => {
  if (typeof level === 'number') {
    return level;
  }
  const upper = String(level).toUpperCase();
  return LogLevel[upper] ?? LogLevel.INFO;
};

/**
 * Formats bytes to human-readable string.
 *
 * @param {number|string} bytes - Bytes or string like "10MB"
 * @returns {number} Bytes
 */
const parseBytes = (bytes) => {
  if (typeof bytes === 'number') {
    return bytes;
  }
  const str = String(bytes).toUpperCase();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)?$/);
  if (!match) {
    return 10 * 1024 * 1024; // Default 10MB
  }
  const value = parseFloat(match[1]);
  const unit = match[2] ?? 'B';
  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  return Math.floor(value * (multipliers[unit] || 1));
};

/**
 * Async-local storage for correlation IDs.
 * Falls back to a simple context object if AsyncLocalStorage is not available.
 */
let asyncLocalStorage;
try {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  asyncLocalStorage = new AsyncLocalStorage();
} catch {
  // Fallback for environments without AsyncLocalStorage
  asyncLocalStorage = {
    _store: null,
    getStore() {
      return this._store;
    },
    run(store, fn) {
      const prev = this._store;
      this._store = store;
      try {
        return fn();
      } finally {
        this._store = prev;
      }
    },
    enterWith(store) {
      this._store = store;
    },
  };
}

/**
 * Context manager for correlation IDs.
 */
export class LogContext {
  /**
   * Runs a function with a correlation ID context.
   *
   * @param {string} [correlationId] - Correlation ID (generated if not provided)
   * @param {Function} fn - Function to run
   * @returns {*} Return value of fn
   */
  static run(correlationId, fn) {
    if (typeof correlationId === 'function') {
      fn = correlationId;
      correlationId = randomUUID();
    }
    return asyncLocalStorage.run({ correlationId }, fn);
  }

  /**
   * Runs an async function with a correlation ID context.
   *
   * @param {string} [correlationId] - Correlation ID (generated if not provided)
   * @param {Function} fn - Async function to run
   * @returns {Promise<*>} Return value of fn
   */
  static runAsync(correlationId, fn) {
    if (typeof correlationId === 'function') {
      fn = correlationId;
      correlationId = randomUUID();
    }
    return Promise.resolve(asyncLocalStorage.run({ correlationId }, fn));
  }

  /**
   * Gets the current correlation ID.
   *
   * @returns {string|undefined} Current correlation ID
   */
  static getCorrelationId() {
    return asyncLocalStorage.getStore()?.correlationId;
  }

  /**
   * Sets the correlation ID for the current context.
   *
   * @param {string} correlationId - Correlation ID
   */
  static setCorrelationId(correlationId) {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.correlationId = correlationId;
    } else {
      asyncLocalStorage.enterWith({ correlationId });
    }
  }

  /**
   * Generates a new correlation ID.
   *
   * @returns {string} New correlation ID
   */
  static generateCorrelationId() {
    return randomUUID();
  }
}

/**
 * Log rotation manager.
 * Handles file rotation based on size or file count.
 */
class LogRotator {
  /**
   * Creates a new LogRotator.
   *
   * @param {Object} options - Rotation options
   * @param {string} options.path - Log file path
   * @param {number|string} [options.maxSize] - Maximum file size before rotation
   * @param {number} [options.maxFiles] - Maximum number of rotated files to keep
   */
  constructor(options) {
    this._path = options.path;
    this._maxSize = parseBytes(options.maxSize ?? '10MB');
    this._maxFiles = options.maxFiles ?? 5;
    this._currentSize = 0;
    this._rotating = false;
  }

  /**
   * Checks if rotation is needed and performs it.
   *
   * @returns {Promise<boolean>} True if rotation was performed
   */
  async checkAndRotate() {
    if (this._rotating) {
      return false;
    }

    try {
      const stats = await stat(this._path);
      this._currentSize = stats.size;

      if (this._currentSize >= this._maxSize) {
        return await this.rotate();
      }
    } catch (error) {
      // File doesn't exist yet, no rotation needed
      if (error.code !== 'ENOENT') {
        console.error('Log rotation check error:', error);
      }
    }
    return false;
  }

  /**
   * Performs log rotation.
   *
   * @returns {Promise<boolean>} True if rotation was successful
   */
  async rotate() {
    if (this._rotating) {
      return false;
    }

    this._rotating = true;
    try {
      const dir = dirname(this._path);
      const ext = extname(this._path);
      const base = basename(this._path, ext);

      // Rotate existing files
      for (let i = this._maxFiles - 1; i >= 1; i--) {
        const oldPath = join(dir, `${base}.${i}${ext}`);
        const newPath = join(dir, `${base}.${i + 1}${ext}`);
        try {
          await rename(oldPath, newPath);
        } catch {
          // File doesn't exist, skip
        }
      }

      // Rename current log to .1
      const rotatedPath = join(dir, `${base}.1${ext}`);
      try {
        await rename(this._path, rotatedPath);
      } catch {
        // Current file doesn't exist or can't be renamed
      }

      // Clean up old files beyond maxFiles
      await this._cleanupOldFiles(dir, base, ext);

      this._currentSize = 0;
      return true;
    } finally {
      this._rotating = false;
    }
  }

  /**
   * Cleans up old rotated log files.
   *
   * @param {string} dir - Directory path
   * @param {string} base - Base filename
   * @param {string} ext - File extension
   * @private
   */
  async _cleanupOldFiles(dir, base, ext) {
    try {
      const files = await readdir(dir);
      const pattern = new RegExp(
        `^${base}\\.(\\d+)${ext.replace('.', '\\.')}$`
      );

      const rotatedFiles = files
        .map((f) => {
          const match = f.match(pattern);
          return match ? { name: f, num: parseInt(match[1], 10) } : null;
        })
        .filter((f) => f !== null)
        .sort((a, b) => b.num - a.num);

      // Remove files beyond maxFiles
      for (const file of rotatedFiles.slice(this._maxFiles)) {
        try {
          await unlink(join(dir, file.name));
        } catch {
          // Ignore deletion errors
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Updates the current file size.
   *
   * @param {number} bytes - Bytes written
   */
  addBytes(bytes) {
    this._currentSize += bytes;
  }
}

/**
 * JSON log formatter.
 */
class JsonFormatter {
  /**
   * Formats a log entry as JSON.
   *
   * @param {Object} entry - Log entry
   * @returns {string} JSON string
   */
  format(entry) {
    return JSON.stringify(entry);
  }
}

/**
 * Text log formatter.
 */
class TextFormatter {
  /**
   * Formats a log entry as text.
   *
   * @param {Object} entry - Log entry
   * @returns {string} Text string
   */
  format(entry) {
    const { timestamp, level, message, correlationId, ...rest } = entry;
    const parts = [new Date(timestamp).toISOString(), `[${level}]`];

    if (correlationId) {
      parts.push(`[${correlationId}]`);
    }

    parts.push(message);

    // Add extra fields
    const extra = Object.entries(rest)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');

    if (extra) {
      parts.push(extra);
    }

    return parts.join(' ');
  }
}

/**
 * Structured logger for links-queue.
 *
 * Supports JSON and text output formats, configurable log levels,
 * correlation ID tracking, and optional file rotation.
 */
export class Logger {
  /**
   * Creates a new Logger.
   *
   * @param {Object} [options] - Logger options
   * @param {string|number} [options.level='info'] - Minimum log level
   * @param {string} [options.format='json'] - Output format ('json' or 'text')
   * @param {string} [options.destination] - File path (defaults to stdout)
   * @param {Object} [options.rotate] - Rotation options
   * @param {string|number} [options.rotate.maxSize] - Maximum file size
   * @param {number} [options.rotate.maxFiles] - Maximum number of rotated files
   * @param {Object} [options.defaultFields] - Default fields to include in all logs
   * @param {boolean} [options.includeTimestamp=true] - Include timestamp in logs
   * @param {boolean} [options.includeCorrelationId=true] - Include correlation ID
   */
  constructor(options = {}) {
    this._level = parseLogLevel(options.level ?? 'info');
    this._format = options.format ?? 'json';
    this._destination = options.destination ?? null;
    this._defaultFields = options.defaultFields ?? {};
    this._includeTimestamp = options.includeTimestamp !== false;
    this._includeCorrelationId = options.includeCorrelationId !== false;

    // Formatter
    this._formatter =
      this._format === 'text' ? new TextFormatter() : new JsonFormatter();

    // File stream and rotation
    this._stream = null;
    this._rotator = null;

    if (this._destination) {
      this._stream = createWriteStream(this._destination, { flags: 'a' });
      if (options.rotate) {
        this._rotator = new LogRotator({
          path: this._destination,
          ...options.rotate,
        });
      }
    }
  }

  /**
   * Gets the current log level.
   *
   * @returns {number} Log level
   */
  get level() {
    return this._level;
  }

  /**
   * Sets the log level.
   *
   * @param {string|number} level - New log level
   */
  setLevel(level) {
    this._level = parseLogLevel(level);
  }

  /**
   * Checks if a level is enabled.
   *
   * @param {number} level - Level to check
   * @returns {boolean} True if enabled
   */
  isLevelEnabled(level) {
    return level >= this._level;
  }

  /**
   * Creates a child logger with additional default fields.
   *
   * @param {Object} fields - Additional default fields
   * @returns {Logger} Child logger
   */
  child(fields) {
    const child = Object.create(this);
    child._defaultFields = { ...this._defaultFields, ...fields };
    return child;
  }

  /**
   * Logs a message at the specified level.
   *
   * @param {number} level - Log level
   * @param {string} message - Log message
   * @param {Object} [fields] - Additional fields
   * @private
   */
  _log(level, message, fields = {}) {
    if (level < this._level) {
      return;
    }

    const entry = {
      ...this._defaultFields,
      level: LOG_LEVEL_NAMES[level],
      message,
      ...fields,
    };

    if (this._includeTimestamp) {
      entry.timestamp = Date.now();
    }

    if (this._includeCorrelationId) {
      const correlationId = LogContext.getCorrelationId();
      if (correlationId) {
        entry.correlationId = correlationId;
      }
    }

    const output = this._formatter.format(entry);
    this._write(`${output}\n`);
  }

  /**
   * Writes output to the destination.
   *
   * @param {string} data - Data to write
   * @private
   */
  _write(data) {
    if (this._stream) {
      this._stream.write(data);
      if (this._rotator) {
        this._rotator.addBytes(Buffer.byteLength(data, 'utf8'));
        // Check rotation asynchronously
        this._rotator.checkAndRotate().catch(() => {});
      }
    } else {
      process.stdout.write(data);
    }
  }

  /**
   * Logs a debug message.
   *
   * @param {string} message - Log message
   * @param {Object} [fields] - Additional fields
   */
  debug(message, fields = {}) {
    this._log(LogLevel.DEBUG, message, fields);
  }

  /**
   * Logs an info message.
   *
   * @param {string} message - Log message
   * @param {Object} [fields] - Additional fields
   */
  info(message, fields = {}) {
    this._log(LogLevel.INFO, message, fields);
  }

  /**
   * Logs a warning message.
   *
   * @param {string} message - Log message
   * @param {Object} [fields] - Additional fields
   */
  warn(message, fields = {}) {
    this._log(LogLevel.WARN, message, fields);
  }

  /**
   * Logs an error message.
   *
   * @param {string} message - Log message
   * @param {Object} [fields] - Additional fields
   */
  error(message, fields = {}) {
    // Handle Error objects
    if (fields instanceof Error) {
      fields = {
        error: fields.message,
        stack: fields.stack,
        name: fields.name,
      };
    }
    this._log(LogLevel.ERROR, message, fields);
  }

  /**
   * Logs a fatal message.
   *
   * @param {string} message - Log message
   * @param {Object} [fields] - Additional fields
   */
  fatal(message, fields = {}) {
    if (fields instanceof Error) {
      fields = {
        error: fields.message,
        stack: fields.stack,
        name: fields.name,
      };
    }
    this._log(LogLevel.FATAL, message, fields);
  }

  /**
   * Flushes the log stream.
   *
   * @returns {Promise<void>}
   */
  flush() {
    if (this._stream) {
      return new Promise((resolve) => {
        this._stream.once('drain', resolve);
        if (this._stream.write('')) {
          resolve();
        }
      });
    }
    return Promise.resolve();
  }

  /**
   * Closes the logger.
   *
   * @returns {Promise<void>}
   */
  close() {
    if (this._stream) {
      return new Promise((resolve, reject) => {
        this._stream.end(() => {
          this._stream = null;
          resolve();
        });
        this._stream.once('error', reject);
      });
    }
    return Promise.resolve();
  }
}

/**
 * Default logger instance.
 */
export const defaultLogger = new Logger({
  level: safeGetEnv('LOG_LEVEL') ?? 'info',
  format: safeGetEnv('LOG_FORMAT') ?? 'json',
});

/**
 * Creates a logger with queue-specific context.
 *
 * @param {Object} options - Logger options
 * @param {string} options.queueName - Queue name
 * @param {string} [options.component] - Component name
 * @returns {Logger} Configured logger
 */
export const createQueueLogger = (options = {}) => {
  const { queueName, component, ...loggerOptions } = options;
  const defaultFields = {};

  if (queueName) {
    defaultFields.queue = queueName;
  }
  if (component) {
    defaultFields.component = component;
  }

  return new Logger({
    ...loggerOptions,
    defaultFields: {
      ...defaultFields,
      ...loggerOptions.defaultFields,
    },
  });
};
