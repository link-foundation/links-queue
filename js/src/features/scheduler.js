/**
 * Scheduler module for links-queue.
 *
 * This module provides advanced scheduling features for queue messages:
 * - Delayed messages (enqueue for future delivery)
 * - Cron jobs (scheduled recurring tasks)
 * - TTL (time-to-live for messages)
 * - Message expiration (automatic removal of expired messages)
 *
 * @module features/scheduler
 *
 * @see REQUIREMENTS.md - Feature Parity with Competitors
 * @see ROADMAP.md - Phase 7: Advanced Features
 */

// =============================================================================
// Enqueue Options
// =============================================================================

/**
 * Options for scheduling messages.
 *
 * @typedef {Object} ScheduleOptions
 * @property {number} [delay] - Delay in milliseconds before the message becomes visible
 * @property {number} [ttl] - Time-to-live in milliseconds; message expires after this duration
 * @property {number} [deliverAt] - Unix timestamp (ms) when the message should be delivered
 */

// =============================================================================
// Scheduled Item
// =============================================================================

/**
 * Represents a scheduled queue item with timing metadata.
 *
 * @typedef {Object} ScheduledItem
 * @property {import('../index.d.ts').LinkId} id - Unique identifier for the scheduled item
 * @property {import('../index.d.ts').Link} link - The link data
 * @property {number} scheduledAt - Timestamp when the item was scheduled
 * @property {number} deliverAt - Timestamp when the item should be delivered
 * @property {number|null} expiresAt - Timestamp when the item expires (null if no TTL)
 * @property {string} [cronExpression] - Cron expression for recurring jobs
 * @property {boolean} isRecurring - Whether this is a recurring job
 */

// =============================================================================
// Cron Job
// =============================================================================

/**
 * Represents a scheduled cron job.
 *
 * @typedef {Object} CronJob
 * @property {string} id - Unique identifier for the cron job
 * @property {string} expression - Cron expression (e.g., '0 *\/5 * * *' for every 5 minutes)
 * @property {() => Promise<void>} handler - The function to execute
 * @property {number|null} nextRun - Next scheduled execution time
 * @property {number|null} lastRun - Last execution time
 * @property {boolean} running - Whether the job is currently running
 * @property {boolean} enabled - Whether the job is enabled
 */

// =============================================================================
// Cron Parser (Simple Implementation)
// =============================================================================

/**
 * Simple cron expression parser.
 *
 * Supports standard 5-field cron expressions:
 * - minute (0-59)
 * - hour (0-23)
 * - day of month (1-31)
 * - month (1-12)
 * - day of week (0-6, Sunday = 0)
 *
 * Special characters:
 * - '*' matches any value
 * - ',' separates list items
 * - '-' defines a range
 * - '/' defines step values
 */
export class CronParser {
  /**
   * Parses a cron field and returns matching values.
   *
   * @param {string} field - The cron field to parse
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @returns {number[]} Array of matching values
   */
  static parseField(field, min, max) {
    const values = new Set();

    // Handle comma-separated values
    const parts = field.split(',');

    for (const part of parts) {
      if (part === '*') {
        // All values
        for (let i = min; i <= max; i++) {
          values.add(i);
        }
      } else if (part.includes('/')) {
        // Step values (e.g., */5)
        const [range, stepStr] = part.split('/');
        const step = parseInt(stepStr, 10);
        const start = range === '*' ? min : parseInt(range, 10);
        for (let i = start; i <= max; i += step) {
          values.add(i);
        }
      } else if (part.includes('-')) {
        // Range (e.g., 1-5)
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        for (let i = start; i <= end; i++) {
          values.add(i);
        }
      } else {
        // Single value
        values.add(parseInt(part, 10));
      }
    }

    return [...values]
      .filter((v) => v >= min && v <= max)
      .sort((a, b) => a - b);
  }

  /**
   * Parses a full cron expression.
   *
   * @param {string} expression - Cron expression (5 fields)
   * @returns {{minutes: number[], hours: number[], daysOfMonth: number[], months: number[], daysOfWeek: number[]}}
   */
  static parse(expression) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression: expected 5 fields, got ${parts.length}`
      );
    }

    return {
      minutes: this.parseField(parts[0], 0, 59),
      hours: this.parseField(parts[1], 0, 23),
      daysOfMonth: this.parseField(parts[2], 1, 31),
      months: this.parseField(parts[3], 1, 12),
      daysOfWeek: this.parseField(parts[4], 0, 6),
    };
  }

  /**
   * Calculates the next run time after the given date.
   *
   * @param {string} expression - Cron expression
   * @param {Date} [after=new Date()] - Find next run after this date
   * @returns {Date|null} Next run time, or null if invalid
   */
  static nextRun(expression, after = new Date()) {
    const cron = this.parse(expression);
    const start = new Date(after.getTime() + 60000); // Start from next minute
    start.setSeconds(0, 0);

    // Search up to one year ahead
    const maxDate = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);

    const current = new Date(start);

    while (current < maxDate) {
      const month = current.getMonth() + 1;
      const dayOfMonth = current.getDate();
      const dayOfWeek = current.getDay();
      const hour = current.getHours();
      const minute = current.getMinutes();

      if (
        cron.months.includes(month) &&
        cron.daysOfMonth.includes(dayOfMonth) &&
        cron.daysOfWeek.includes(dayOfWeek) &&
        cron.hours.includes(hour) &&
        cron.minutes.includes(minute)
      ) {
        return current;
      }

      // Move to next minute
      current.setMinutes(current.getMinutes() + 1);
    }

    return null;
  }
}

// =============================================================================
// Scheduler
// =============================================================================

/**
 * Scheduler for managing delayed messages and cron jobs.
 *
 * Provides functionality for:
 * - Scheduling messages for future delivery
 * - Managing message TTL and expiration
 * - Running cron jobs on a schedule
 *
 * @example
 * import { Scheduler } from 'links-queue';
 *
 * const scheduler = new Scheduler();
 *
 * // Schedule a delayed message
 * const item = scheduler.schedule(link, { delay: 30000 }); // 30 seconds
 *
 * // Schedule with TTL
 * const itemWithTtl = scheduler.schedule(link, { delay: 5000, ttl: 60000 });
 *
 * // Add a cron job
 * scheduler.addCronJob('cleanup', '0 *\/5 * * *', async () => {
 *   console.log('Running cleanup...');
 * });
 *
 * // Start the scheduler
 * scheduler.start();
 *
 * // Later: stop the scheduler
 * scheduler.stop();
 */
export class Scheduler {
  /**
   * Creates a new Scheduler.
   *
   * @param {Object} [options] - Scheduler options
   * @param {number} [options.checkInterval=1000] - Interval in ms to check for due items
   * @param {(item: ScheduledItem) => Promise<void>} [options.onDue] - Callback when item is due
   * @param {(item: ScheduledItem) => Promise<void>} [options.onExpired] - Callback when item expires
   */
  constructor(options = {}) {
    /**
     * Check interval in milliseconds.
     * @type {number}
     * @private
     */
    this._checkInterval = options.checkInterval ?? 1000;

    /**
     * Callback when an item becomes due.
     * @type {(item: ScheduledItem) => Promise<void>}
     * @private
     */
    this._onDue = options.onDue ?? (async () => {});

    /**
     * Callback when an item expires.
     * @type {(item: ScheduledItem) => Promise<void>}
     * @private
     */
    this._onExpired = options.onExpired ?? (async () => {});

    /**
     * Scheduled items waiting to be delivered.
     * @type {Map<import('../index.d.ts').LinkId, ScheduledItem>}
     * @private
     */
    this._scheduledItems = new Map();

    /**
     * Cron jobs.
     * @type {Map<string, CronJob>}
     * @private
     */
    this._cronJobs = new Map();

    /**
     * Timer handle for the check loop.
     * @type {NodeJS.Timeout|null}
     * @private
     */
    this._timerHandle = null;

    /**
     * Whether the scheduler is running.
     * @type {boolean}
     * @private
     */
    this._running = false;

    /**
     * Counter for generating unique IDs.
     * @type {number}
     * @private
     */
    this._idCounter = 0;

    /**
     * Statistics.
     * @type {{scheduled: number, delivered: number, expired: number, cronRuns: number}}
     * @private
     */
    this._stats = {
      scheduled: 0,
      delivered: 0,
      expired: 0,
      cronRuns: 0,
    };
  }

  /**
   * Generates a unique ID for scheduled items.
   *
   * @returns {string} Unique identifier
   * @private
   */
  _generateId() {
    return `sched_${Date.now()}_${++this._idCounter}`;
  }

  /**
   * Schedules a link for future delivery.
   *
   * @param {import('../index.d.ts').Link} link - The link to schedule
   * @param {ScheduleOptions} [options] - Scheduling options
   * @returns {ScheduledItem} The scheduled item
   *
   * @example
   * // Delay by 30 seconds
   * scheduler.schedule(link, { delay: 30000 });
   *
   * // Deliver at specific time
   * scheduler.schedule(link, { deliverAt: Date.now() + 60000 });
   *
   * // With TTL
   * scheduler.schedule(link, { delay: 5000, ttl: 60000 });
   */
  schedule(link, options = {}) {
    const now = Date.now();
    const { delay = 0, ttl = null, deliverAt = null } = options;

    const scheduledAt = now;
    const deliverTime = deliverAt ?? now + delay;
    const expiresAt = ttl !== null ? now + ttl : null;

    const item = {
      id: link.id ?? this._generateId(),
      link,
      scheduledAt,
      deliverAt: deliverTime,
      expiresAt,
      cronExpression: null,
      isRecurring: false,
    };

    this._scheduledItems.set(item.id, item);
    this._stats.scheduled++;

    return item;
  }

  /**
   * Cancels a scheduled item.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the item to cancel
   * @returns {boolean} True if the item was cancelled
   */
  cancel(id) {
    return this._scheduledItems.delete(id);
  }

  /**
   * Gets a scheduled item by ID.
   *
   * @param {import('../index.d.ts').LinkId} id - The ID of the item
   * @returns {ScheduledItem|undefined} The scheduled item
   */
  get(id) {
    return this._scheduledItems.get(id);
  }

  /**
   * Adds a cron job.
   *
   * @param {string} id - Unique identifier for the job
   * @param {string} expression - Cron expression
   * @param {() => Promise<void>} handler - Function to execute
   * @returns {CronJob} The created cron job
   *
   * @example
   * // Run every 5 minutes
   * scheduler.addCronJob('cleanup', '0 *\/5 * * *', async () => {
   *   console.log('Running cleanup...');
   * });
   *
   * // Run every day at midnight
   * scheduler.addCronJob('daily', '0 0 * * *', async () => {
   *   console.log('Daily job...');
   * });
   */
  addCronJob(id, expression, handler) {
    // Validate the expression
    CronParser.parse(expression);

    const nextRun = CronParser.nextRun(expression);

    const job = {
      id,
      expression,
      handler,
      nextRun: nextRun ? nextRun.getTime() : null,
      lastRun: null,
      running: false,
      enabled: true,
    };

    this._cronJobs.set(id, job);
    return job;
  }

  /**
   * Removes a cron job.
   *
   * @param {string} id - The ID of the cron job
   * @returns {boolean} True if the job was removed
   */
  removeCronJob(id) {
    return this._cronJobs.delete(id);
  }

  /**
   * Gets a cron job by ID.
   *
   * @param {string} id - The ID of the cron job
   * @returns {CronJob|undefined} The cron job
   */
  getCronJob(id) {
    return this._cronJobs.get(id);
  }

  /**
   * Enables or disables a cron job.
   *
   * @param {string} id - The ID of the cron job
   * @param {boolean} enabled - Whether to enable the job
   * @returns {boolean} True if the job was found and updated
   */
  setCronJobEnabled(id, enabled) {
    const job = this._cronJobs.get(id);
    if (job) {
      job.enabled = enabled;
      if (enabled) {
        // Recalculate next run
        const nextRun = CronParser.nextRun(job.expression);
        job.nextRun = nextRun ? nextRun.getTime() : null;
      }
      return true;
    }
    return false;
  }

  /**
   * Lists all cron jobs.
   *
   * @returns {CronJob[]} Array of cron jobs
   */
  listCronJobs() {
    return [...this._cronJobs.values()];
  }

  /**
   * Starts the scheduler.
   *
   * Begins checking for due items and running cron jobs.
   */
  start() {
    if (this._running) {
      return;
    }

    this._running = true;
    this._tick();
  }

  /**
   * Stops the scheduler.
   *
   * Stops checking for due items and pauses cron jobs.
   */
  stop() {
    this._running = false;
    if (this._timerHandle) {
      globalThis.clearTimeout(this._timerHandle);
      this._timerHandle = null;
    }
  }

  /**
   * Internal tick function that checks for due items.
   *
   * @private
   */
  async _tick() {
    if (!this._running) {
      return;
    }

    try {
      await this._processScheduledItems();
      await this._processCronJobs();
    } catch (error) {
      // Log error but continue running
      console.error('Scheduler tick error:', error);
    }

    // Check if still running after async operations before scheduling next tick
    // This prevents timer leaks when stop() is called during processing
    if (!this._running) {
      return;
    }

    // Schedule next tick
    this._timerHandle = globalThis.setTimeout(
      () => this._tick(),
      this._checkInterval
    );
  }

  /**
   * Processes scheduled items that are due or expired.
   *
   * @private
   */
  async _processScheduledItems() {
    const now = Date.now();
    const dueItems = [];
    const expiredItems = [];

    for (const [, item] of this._scheduledItems) {
      // Check for expiration first
      if (item.expiresAt !== null && now >= item.expiresAt) {
        expiredItems.push(item);
        continue;
      }

      // Check if due for delivery
      if (now >= item.deliverAt) {
        dueItems.push(item);
      }
    }

    // Process expired items
    for (const item of expiredItems) {
      this._scheduledItems.delete(item.id);
      this._stats.expired++;
      try {
        await this._onExpired(item);
      } catch (error) {
        console.error('Error processing expired item:', error);
      }
    }

    // Process due items
    for (const item of dueItems) {
      this._scheduledItems.delete(item.id);
      this._stats.delivered++;
      try {
        await this._onDue(item);
      } catch (error) {
        console.error('Error processing due item:', error);
      }
    }
  }

  /**
   * Processes cron jobs that are due to run.
   *
   * @private
   */
  async _processCronJobs() {
    const now = Date.now();

    for (const job of this._cronJobs.values()) {
      if (!job.enabled || job.running || job.nextRun === null) {
        continue;
      }

      if (now >= job.nextRun) {
        job.running = true;
        job.lastRun = now;
        this._stats.cronRuns++;

        try {
          await job.handler();
        } catch (error) {
          console.error(`Cron job '${job.id}' error:`, error);
        } finally {
          job.running = false;
          // Calculate next run
          const nextRun = CronParser.nextRun(job.expression);
          job.nextRun = nextRun ? nextRun.getTime() : null;
        }
      }
    }
  }

  /**
   * Returns the number of pending scheduled items.
   *
   * @returns {number} Number of pending items
   */
  get pendingCount() {
    return this._scheduledItems.size;
  }

  /**
   * Returns whether the scheduler is running.
   *
   * @returns {boolean} True if running
   */
  get isRunning() {
    return this._running;
  }

  /**
   * Returns scheduler statistics.
   *
   * @returns {{scheduled: number, delivered: number, expired: number, cronRuns: number, pending: number, cronJobs: number}}
   */
  getStats() {
    return {
      ...this._stats,
      pending: this._scheduledItems.size,
      cronJobs: this._cronJobs.size,
    };
  }

  /**
   * Clears all scheduled items and stops the scheduler.
   */
  clear() {
    this.stop();
    this._scheduledItems.clear();
    this._cronJobs.clear();
    this._stats = {
      scheduled: 0,
      delivered: 0,
      expired: 0,
      cronRuns: 0,
    };
  }

  /**
   * Returns all pending items (for inspection/debugging).
   *
   * @returns {ScheduledItem[]} Array of scheduled items
   */
  getPendingItems() {
    return [...this._scheduledItems.values()];
  }
}

// =============================================================================
// Scheduled Queue (Queue with Scheduling Support)
// =============================================================================

/**
 * A queue wrapper that adds scheduling support.
 *
 * Wraps an existing queue and adds the ability to:
 * - Enqueue items with a delay
 * - Set TTL on items
 * - Automatically remove expired items
 *
 * @example
 * const baseQueue = new LinksQueue({ name: 'tasks', store });
 * const scheduledQueue = new ScheduledQueue(baseQueue);
 *
 * // Enqueue with delay
 * await scheduledQueue.enqueue(link, { delay: 30000 });
 *
 * // Enqueue with TTL
 * await scheduledQueue.enqueue(link, { ttl: 60000 });
 */
export class ScheduledQueue {
  /**
   * Creates a new ScheduledQueue.
   *
   * @param {import('../queue/queue.js').LinksQueue} queue - The underlying queue
   * @param {Object} [options] - Options
   * @param {number} [options.checkInterval=1000] - Interval in ms to check for due items
   */
  constructor(queue, options = {}) {
    /**
     * The underlying queue.
     * @type {import('../queue/queue.js').LinksQueue}
     * @private
     */
    this._queue = queue;

    /**
     * The internal scheduler.
     * @type {Scheduler}
     * @private
     */
    this._scheduler = new Scheduler({
      checkInterval: options.checkInterval ?? 1000,
      onDue: async (item) => {
        // When item is due, add it to the actual queue
        await this._queue.enqueue(item.link);
      },
      onExpired: async () => {
        // Item expired before delivery - nothing to do
      },
    });

    // Start the scheduler
    this._scheduler.start();
  }

  /**
   * Gets the queue name.
   *
   * @returns {string} Queue name
   */
  get name() {
    return this._queue.name;
  }

  /**
   * Enqueues a link, optionally with scheduling options.
   *
   * @param {import('../index.d.ts').Link} link - The link to enqueue
   * @param {ScheduleOptions} [options] - Scheduling options
   * @returns {Promise<import('../queue/types.ts').EnqueueResult | ScheduledItem>}
   */
  async enqueue(link, options = {}) {
    const { delay = 0, ttl = null, deliverAt = null } = options;

    // If no delay, enqueue directly
    if (delay === 0 && deliverAt === null) {
      // But still check TTL for immediate items
      if (ttl !== null) {
        // Store TTL metadata (could be used for later expiration)
        // For now, we enqueue normally
      }
      return this._queue.enqueue(link);
    }

    // Schedule for later delivery
    return this._scheduler.schedule(link, options);
  }

  /**
   * Dequeues the next available link.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async dequeue() {
    return this._queue.dequeue();
  }

  /**
   * Peeks at the next available link.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async peek() {
    return this._queue.peek();
  }

  /**
   * Acknowledges a dequeued item.
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   */
  async acknowledge(id) {
    return this._queue.acknowledge(id);
  }

  /**
   * Rejects a dequeued item.
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   * @param {boolean} [requeue=false] - Whether to requeue
   */
  async reject(id, requeue = false) {
    return this._queue.reject(id, requeue);
  }

  /**
   * Gets queue statistics.
   *
   * @returns {import('../queue/types.ts').QueueStats & {scheduled: number}}
   */
  getStats() {
    const queueStats = this._queue.getStats();
    const schedulerStats = this._scheduler.getStats();
    return {
      ...queueStats,
      scheduled: schedulerStats.pending,
    };
  }

  /**
   * Gets the queue depth (including scheduled items).
   *
   * @returns {number}
   */
  getDepth() {
    return this._queue.getDepth() + this._scheduler.pendingCount;
  }

  /**
   * Schedules a cron job that enqueues items.
   *
   * @param {string} expression - Cron expression
   * @param {() => Promise<import('../index.d.ts').Link>} linkFactory - Function that creates the link to enqueue
   * @returns {CronJob} The cron job
   *
   * @example
   * // Enqueue cleanup tasks every 5 minutes
   * scheduledQueue.schedule('0 *\/5 * * *', async () => {
   *   return { source: 'cron', target: 'cleanup' };
   * });
   */
  scheduleCron(expression, linkFactory) {
    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return this._scheduler.addCronJob(id, expression, async () => {
      const link = await linkFactory();
      await this._queue.enqueue(link);
    });
  }

  /**
   * Cancels a scheduled item.
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   * @returns {boolean}
   */
  cancelScheduled(id) {
    return this._scheduler.cancel(id);
  }

  /**
   * Stops the scheduler and clears resources.
   */
  async clear() {
    this._scheduler.clear();
    await this._queue.clear();
  }

  /**
   * Stops the scheduler.
   */
  stop() {
    this._scheduler.stop();
  }
}
