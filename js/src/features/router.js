/**
 * Router module for links-queue.
 *
 * This module provides topic-based routing features:
 * - Topic-based routing with wildcards
 * - Exchange types (direct, topic, fanout)
 * - Pattern matching on link content
 * - Binding management
 *
 * @module features/router
 *
 * @see REQUIREMENTS.md - Feature Parity with Competitors
 * @see ROADMAP.md - Phase 7: Advanced Features
 */

// =============================================================================
// Exchange Types
// =============================================================================

/**
 * Exchange types for message routing.
 * @readonly
 * @enum {string}
 */
export const ExchangeType = Object.freeze({
  /** Direct exchange: routes to queues with exact routing key match */
  DIRECT: 'direct',
  /** Topic exchange: routes using wildcard patterns */
  TOPIC: 'topic',
  /** Fanout exchange: routes to all bound queues */
  FANOUT: 'fanout',
  /** Headers exchange: routes based on message headers/attributes */
  HEADERS: 'headers',
});

// =============================================================================
// Binding
// =============================================================================

/**
 * Represents a binding between an exchange and a queue.
 *
 * @typedef {Object} Binding
 * @property {string} id - Unique binding identifier
 * @property {string} exchange - Exchange name
 * @property {string} queue - Queue name
 * @property {string} routingKey - Routing key or pattern
 * @property {Object} [arguments] - Optional binding arguments
 */

// =============================================================================
// Topic Pattern Matcher
// =============================================================================

/**
 * Matches routing keys against topic patterns.
 *
 * Supports AMQP-style wildcards:
 * - `*` matches exactly one word
 * - `#` matches zero or more words
 *
 * Words are separated by dots (.).
 *
 * @example
 * const matcher = new TopicMatcher();
 *
 * matcher.matches('logs.*', 'logs.error');      // true
 * matcher.matches('logs.*', 'logs.error.db');   // false
 * matcher.matches('logs.#', 'logs.error.db');   // true
 * matcher.matches('*.error', 'logs.error');     // true
 * matcher.matches('#.error', 'a.b.c.error');    // true
 */
export class TopicMatcher {
  /**
   * Checks if a routing key matches a pattern.
   *
   * @param {string} pattern - The pattern (may contain * and #)
   * @param {string} routingKey - The routing key to match
   * @returns {boolean} True if the key matches the pattern
   */
  static matches(pattern, routingKey) {
    // Convert pattern to regex
    const regex = this._patternToRegex(pattern);
    return regex.test(routingKey);
  }

  /**
   * Converts a topic pattern to a regular expression.
   * Implements AMQP-style topic wildcards:
   * - * matches exactly one word
   * - # matches zero or more words
   *
   * @param {string} pattern - The topic pattern
   * @returns {RegExp} The compiled regex
   * @private
   */
  static _patternToRegex(pattern) {
    // Handle special case: just "#" matches everything
    if (pattern === '#') {
      return /^.+$/;
    }

    // Split pattern into parts and build regex
    const parts = pattern.split('.');
    const regexParts = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part === '#') {
        if (i === 0) {
          // # at start: matches zero or more words followed by a dot (or nothing)
          regexParts.push('([^.]+\\.)*');
        } else if (i === parts.length - 1) {
          // # at end: matches zero or more .word sequences
          regexParts.push('(\\.[^.]+)*');
        } else {
          // # in middle: matches zero or more .word. sequences
          regexParts.push('(\\.[^.]+)*\\.');
        }
      } else if (part === '*') {
        regexParts.push('[^.]+');
        if (i < parts.length - 1) {
          regexParts.push('\\.');
        }
      } else {
        // Escape special regex chars in literal parts
        const escaped = part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        regexParts.push(escaped);
        if (i < parts.length - 1 && parts[i + 1] !== '#') {
          regexParts.push('\\.');
        }
      }
    }

    return new RegExp(`^${regexParts.join('')}$`);
  }

  /**
   * Scores a pattern for specificity (more specific = higher score).
   *
   * @param {string} pattern - The pattern to score
   * @returns {number} Specificity score
   */
  static specificity(pattern) {
    let score = 0;
    const parts = pattern.split('.');

    for (const part of parts) {
      if (part === '#') {
        score += 1; // Lowest specificity
      } else if (part === '*') {
        score += 10; // Medium specificity
      } else {
        score += 100; // Highest specificity (exact match)
      }
    }

    return score;
  }
}

// =============================================================================
// Direct Exchange
// =============================================================================

/**
 * Direct exchange: routes messages to queues with exact routing key match.
 *
 * @example
 * const exchange = new DirectExchange('logs');
 *
 * exchange.bind('errors-queue', 'error');
 * exchange.bind('info-queue', 'info');
 *
 * exchange.route('error');  // ['errors-queue']
 * exchange.route('info');   // ['info-queue']
 * exchange.route('debug');  // []
 */
export class DirectExchange {
  /**
   * Creates a new DirectExchange.
   *
   * @param {string} name - Exchange name
   */
  constructor(name) {
    /**
     * Exchange name.
     * @type {string}
     */
    this.name = name;

    /**
     * Exchange type.
     * @type {string}
     */
    this.type = ExchangeType.DIRECT;

    /**
     * Bindings by routing key.
     * @type {Map<string, Set<string>>}
     * @private
     */
    this._bindings = new Map();

    /**
     * All bindings.
     * @type {Map<string, Binding>}
     * @private
     */
    this._bindingDetails = new Map();

    /**
     * ID counter.
     * @type {number}
     * @private
     */
    this._idCounter = 0;
  }

  /**
   * Binds a queue to this exchange with a routing key.
   *
   * @param {string} queue - Queue name
   * @param {string} routingKey - Routing key
   * @returns {Binding} The created binding
   */
  bind(queue, routingKey) {
    if (!this._bindings.has(routingKey)) {
      this._bindings.set(routingKey, new Set());
    }
    this._bindings.get(routingKey).add(queue);

    const binding = {
      id: `${this.name}-${++this._idCounter}`,
      exchange: this.name,
      queue,
      routingKey,
    };
    this._bindingDetails.set(binding.id, binding);

    return binding;
  }

  /**
   * Unbinds a queue from this exchange.
   *
   * @param {string} queue - Queue name
   * @param {string} routingKey - Routing key
   * @returns {boolean} True if the binding was removed
   */
  unbind(queue, routingKey) {
    const queues = this._bindings.get(routingKey);
    if (queues) {
      const removed = queues.delete(queue);
      if (queues.size === 0) {
        this._bindings.delete(routingKey);
      }

      // Remove from details
      for (const [id, binding] of this._bindingDetails) {
        if (binding.queue === queue && binding.routingKey === routingKey) {
          this._bindingDetails.delete(id);
          break;
        }
      }

      return removed;
    }
    return false;
  }

  /**
   * Routes a message to matching queues.
   *
   * @param {string} routingKey - The routing key
   * @returns {string[]} Array of queue names
   */
  route(routingKey) {
    const queues = this._bindings.get(routingKey);
    return queues ? [...queues] : [];
  }

  /**
   * Gets all bindings.
   *
   * @returns {Binding[]}
   */
  getBindings() {
    return [...this._bindingDetails.values()];
  }

  /**
   * Clears all bindings.
   */
  clear() {
    this._bindings.clear();
    this._bindingDetails.clear();
  }
}

// =============================================================================
// Topic Exchange
// =============================================================================

/**
 * Topic exchange: routes messages using wildcard patterns.
 *
 * @example
 * const exchange = new TopicExchange('events');
 *
 * exchange.bind('all-logs', 'logs.#');
 * exchange.bind('errors-only', 'logs.error');
 * exchange.bind('system', '*.system.*');
 *
 * exchange.route('logs.error');        // ['all-logs', 'errors-only']
 * exchange.route('logs.info');         // ['all-logs']
 * exchange.route('app.system.startup'); // ['system']
 */
export class TopicExchange {
  /**
   * Creates a new TopicExchange.
   *
   * @param {string} name - Exchange name
   */
  constructor(name) {
    /**
     * Exchange name.
     * @type {string}
     */
    this.name = name;

    /**
     * Exchange type.
     * @type {string}
     */
    this.type = ExchangeType.TOPIC;

    /**
     * Bindings with patterns.
     * @type {Array<{pattern: string, queue: string, binding: Binding}>}
     * @private
     */
    this._bindings = [];

    /**
     * ID counter.
     * @type {number}
     * @private
     */
    this._idCounter = 0;
  }

  /**
   * Binds a queue to this exchange with a pattern.
   *
   * @param {string} queue - Queue name
   * @param {string} pattern - Topic pattern (may contain * and #)
   * @returns {Binding} The created binding
   */
  bind(queue, pattern) {
    const binding = {
      id: `${this.name}-${++this._idCounter}`,
      exchange: this.name,
      queue,
      routingKey: pattern,
    };

    this._bindings.push({ pattern, queue, binding });

    // Sort by specificity (most specific first)
    this._bindings.sort(
      (a, b) =>
        TopicMatcher.specificity(b.pattern) -
        TopicMatcher.specificity(a.pattern)
    );

    return binding;
  }

  /**
   * Unbinds a queue from this exchange.
   *
   * @param {string} queue - Queue name
   * @param {string} pattern - Topic pattern
   * @returns {boolean} True if the binding was removed
   */
  unbind(queue, pattern) {
    const idx = this._bindings.findIndex(
      (b) => b.queue === queue && b.pattern === pattern
    );
    if (idx !== -1) {
      this._bindings.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Routes a message to matching queues.
   *
   * @param {string} routingKey - The routing key
   * @returns {string[]} Array of queue names (deduplicated)
   */
  route(routingKey) {
    const queues = new Set();

    for (const { pattern, queue } of this._bindings) {
      if (TopicMatcher.matches(pattern, routingKey)) {
        queues.add(queue);
      }
    }

    return [...queues];
  }

  /**
   * Gets all bindings.
   *
   * @returns {Binding[]}
   */
  getBindings() {
    return this._bindings.map((b) => b.binding);
  }

  /**
   * Clears all bindings.
   */
  clear() {
    this._bindings = [];
  }
}

// =============================================================================
// Fanout Exchange
// =============================================================================

/**
 * Fanout exchange: routes messages to all bound queues.
 *
 * @example
 * const exchange = new FanoutExchange('notifications');
 *
 * exchange.bind('email-queue');
 * exchange.bind('sms-queue');
 * exchange.bind('push-queue');
 *
 * exchange.route();  // ['email-queue', 'sms-queue', 'push-queue']
 */
export class FanoutExchange {
  /**
   * Creates a new FanoutExchange.
   *
   * @param {string} name - Exchange name
   */
  constructor(name) {
    /**
     * Exchange name.
     * @type {string}
     */
    this.name = name;

    /**
     * Exchange type.
     * @type {string}
     */
    this.type = ExchangeType.FANOUT;

    /**
     * Bound queues.
     * @type {Set<string>}
     * @private
     */
    this._queues = new Set();

    /**
     * Bindings.
     * @type {Map<string, Binding>}
     * @private
     */
    this._bindings = new Map();

    /**
     * ID counter.
     * @type {number}
     * @private
     */
    this._idCounter = 0;
  }

  /**
   * Binds a queue to this exchange.
   *
   * @param {string} queue - Queue name
   * @returns {Binding} The created binding
   */
  bind(queue) {
    this._queues.add(queue);

    const binding = {
      id: `${this.name}-${++this._idCounter}`,
      exchange: this.name,
      queue,
      routingKey: '',
    };
    this._bindings.set(queue, binding);

    return binding;
  }

  /**
   * Unbinds a queue from this exchange.
   *
   * @param {string} queue - Queue name
   * @returns {boolean} True if the binding was removed
   */
  unbind(queue) {
    this._bindings.delete(queue);
    return this._queues.delete(queue);
  }

  /**
   * Routes a message to all bound queues.
   *
   * @returns {string[]} Array of all bound queue names
   */
  route() {
    return [...this._queues];
  }

  /**
   * Gets all bindings.
   *
   * @returns {Binding[]}
   */
  getBindings() {
    return [...this._bindings.values()];
  }

  /**
   * Clears all bindings.
   */
  clear() {
    this._queues.clear();
    this._bindings.clear();
  }
}

// =============================================================================
// Headers Exchange
// =============================================================================

/**
 * Headers exchange: routes messages based on header values.
 *
 * @example
 * const exchange = new HeadersExchange('tasks');
 *
 * exchange.bind('high-priority', { priority: 'high' }, 'all');
 * exchange.bind('urgent-system', { priority: 'high', type: 'system' }, 'all');
 *
 * exchange.route({ priority: 'high' });                      // ['high-priority']
 * exchange.route({ priority: 'high', type: 'system' });     // ['high-priority', 'urgent-system']
 */
export class HeadersExchange {
  /**
   * Creates a new HeadersExchange.
   *
   * @param {string} name - Exchange name
   */
  constructor(name) {
    /**
     * Exchange name.
     * @type {string}
     */
    this.name = name;

    /**
     * Exchange type.
     * @type {string}
     */
    this.type = ExchangeType.HEADERS;

    /**
     * Bindings with header matchers.
     * @type {Array<{headers: Object, matchType: 'all' | 'any', queue: string, binding: Binding}>}
     * @private
     */
    this._bindings = [];

    /**
     * ID counter.
     * @type {number}
     * @private
     */
    this._idCounter = 0;
  }

  /**
   * Binds a queue to this exchange with header matching.
   *
   * @param {string} queue - Queue name
   * @param {Object} headers - Headers to match
   * @param {'all' | 'any'} [matchType='all'] - 'all' requires all headers to match, 'any' requires at least one
   * @returns {Binding} The created binding
   */
  bind(queue, headers, matchType = 'all') {
    const binding = {
      id: `${this.name}-${++this._idCounter}`,
      exchange: this.name,
      queue,
      routingKey: '',
      arguments: { headers, matchType },
    };

    this._bindings.push({ headers, matchType, queue, binding });

    return binding;
  }

  /**
   * Unbinds a queue from this exchange.
   *
   * @param {string} queue - Queue name
   * @param {Object} headers - Headers that were used in binding
   * @returns {boolean} True if the binding was removed
   */
  unbind(queue, headers) {
    const headerKeys = Object.keys(headers).sort().join(',');
    const idx = this._bindings.findIndex((b) => {
      const bKeys = Object.keys(b.headers).sort().join(',');
      return b.queue === queue && bKeys === headerKeys;
    });

    if (idx !== -1) {
      this._bindings.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Routes a message based on its headers.
   *
   * @param {Object} messageHeaders - The message headers
   * @returns {string[]} Array of queue names
   */
  route(messageHeaders) {
    const queues = new Set();

    for (const { headers, matchType, queue } of this._bindings) {
      let matches = false;

      if (matchType === 'all') {
        // All specified headers must match
        matches = Object.entries(headers).every(
          ([key, value]) => messageHeaders[key] === value
        );
      } else {
        // Any specified header must match
        matches = Object.entries(headers).some(
          ([key, value]) => messageHeaders[key] === value
        );
      }

      if (matches) {
        queues.add(queue);
      }
    }

    return [...queues];
  }

  /**
   * Gets all bindings.
   *
   * @returns {Binding[]}
   */
  getBindings() {
    return this._bindings.map((b) => b.binding);
  }

  /**
   * Clears all bindings.
   */
  clear() {
    this._bindings = [];
  }
}

// =============================================================================
// Router
// =============================================================================

/**
 * Central router for managing exchanges and routing messages.
 *
 * @example
 * const router = new Router();
 *
 * // Create exchanges
 * router.declareExchange('logs', 'topic');
 * router.declareExchange('notifications', 'fanout');
 *
 * // Bind queues
 * router.bind('logs', 'errors-queue', 'logs.error');
 * router.bind('logs', 'all-logs', 'logs.#');
 * router.bind('notifications', 'email-queue');
 *
 * // Route messages
 * const queues1 = router.route('logs', 'logs.error');  // ['errors-queue', 'all-logs']
 * const queues2 = router.route('notifications');       // ['email-queue']
 */
export class Router {
  /**
   * Creates a new Router.
   */
  constructor() {
    /**
     * Exchanges by name.
     * @type {Map<string, DirectExchange | TopicExchange | FanoutExchange | HeadersExchange>}
     * @private
     */
    this._exchanges = new Map();

    /**
     * Queue registry (for validation).
     * @type {Set<string>}
     * @private
     */
    this._queues = new Set();
  }

  /**
   * Declares an exchange.
   *
   * @param {string} name - Exchange name
   * @param {'direct' | 'topic' | 'fanout' | 'headers'} type - Exchange type
   * @returns {DirectExchange | TopicExchange | FanoutExchange | HeadersExchange} The exchange
   */
  declareExchange(name, type) {
    if (this._exchanges.has(name)) {
      const existing = this._exchanges.get(name);
      if (existing.type !== type) {
        throw new Error(
          `Exchange '${name}' already exists with different type`
        );
      }
      return existing;
    }

    let exchange;
    switch (type) {
      case ExchangeType.DIRECT:
        exchange = new DirectExchange(name);
        break;
      case ExchangeType.TOPIC:
        exchange = new TopicExchange(name);
        break;
      case ExchangeType.FANOUT:
        exchange = new FanoutExchange(name);
        break;
      case ExchangeType.HEADERS:
        exchange = new HeadersExchange(name);
        break;
      default:
        throw new Error(`Unknown exchange type: ${type}`);
    }

    this._exchanges.set(name, exchange);
    return exchange;
  }

  /**
   * Gets an exchange by name.
   *
   * @param {string} name - Exchange name
   * @returns {DirectExchange | TopicExchange | FanoutExchange | HeadersExchange | undefined}
   */
  getExchange(name) {
    return this._exchanges.get(name);
  }

  /**
   * Deletes an exchange.
   *
   * @param {string} name - Exchange name
   * @returns {boolean} True if the exchange was deleted
   */
  deleteExchange(name) {
    return this._exchanges.delete(name);
  }

  /**
   * Registers a queue (for validation).
   *
   * @param {string} name - Queue name
   */
  registerQueue(name) {
    this._queues.add(name);
  }

  /**
   * Unregisters a queue.
   *
   * @param {string} name - Queue name
   * @returns {boolean}
   */
  unregisterQueue(name) {
    return this._queues.delete(name);
  }

  /**
   * Binds a queue to an exchange.
   *
   * @param {string} exchangeName - Exchange name
   * @param {string} queueName - Queue name
   * @param {string} [routingKey=''] - Routing key or pattern
   * @param {Object} [args] - Additional binding arguments (for headers exchange)
   * @returns {Binding} The created binding
   */
  bind(exchangeName, queueName, routingKey = '', args = {}) {
    const exchange = this._exchanges.get(exchangeName);
    if (!exchange) {
      throw new Error(`Exchange '${exchangeName}' not found`);
    }

    switch (exchange.type) {
      case ExchangeType.DIRECT:
        return exchange.bind(queueName, routingKey);
      case ExchangeType.TOPIC:
        return exchange.bind(queueName, routingKey);
      case ExchangeType.FANOUT:
        return exchange.bind(queueName);
      case ExchangeType.HEADERS:
        return exchange.bind(queueName, args.headers || {}, args.matchType);
      default:
        throw new Error(`Unknown exchange type: ${exchange.type}`);
    }
  }

  /**
   * Unbinds a queue from an exchange.
   *
   * @param {string} exchangeName - Exchange name
   * @param {string} queueName - Queue name
   * @param {string} [routingKey=''] - Routing key or pattern
   * @param {Object} [args] - Additional binding arguments
   * @returns {boolean} True if the binding was removed
   */
  unbind(exchangeName, queueName, routingKey = '', args = {}) {
    const exchange = this._exchanges.get(exchangeName);
    if (!exchange) {
      return false;
    }

    switch (exchange.type) {
      case ExchangeType.DIRECT:
        return exchange.unbind(queueName, routingKey);
      case ExchangeType.TOPIC:
        return exchange.unbind(queueName, routingKey);
      case ExchangeType.FANOUT:
        return exchange.unbind(queueName);
      case ExchangeType.HEADERS:
        return exchange.unbind(queueName, args.headers || {});
      default:
        return false;
    }
  }

  /**
   * Routes a message through an exchange.
   *
   * @param {string} exchangeName - Exchange name
   * @param {string} [routingKey=''] - Routing key
   * @param {Object} [headers={}] - Message headers (for headers exchange)
   * @returns {string[]} Array of queue names
   */
  route(exchangeName, routingKey = '', headers = {}) {
    const exchange = this._exchanges.get(exchangeName);
    if (!exchange) {
      return [];
    }

    switch (exchange.type) {
      case ExchangeType.DIRECT:
        return exchange.route(routingKey);
      case ExchangeType.TOPIC:
        return exchange.route(routingKey);
      case ExchangeType.FANOUT:
        return exchange.route();
      case ExchangeType.HEADERS:
        return exchange.route(headers);
      default:
        return [];
    }
  }

  /**
   * Lists all exchanges.
   *
   * @returns {Array<{name: string, type: string, bindings: number}>}
   */
  listExchanges() {
    return [...this._exchanges.values()].map((ex) => ({
      name: ex.name,
      type: ex.type,
      bindings: ex.getBindings().length,
    }));
  }

  /**
   * Gets all bindings for an exchange.
   *
   * @param {string} exchangeName - Exchange name
   * @returns {Binding[]}
   */
  getBindings(exchangeName) {
    const exchange = this._exchanges.get(exchangeName);
    return exchange ? exchange.getBindings() : [];
  }

  /**
   * Clears all exchanges.
   */
  clear() {
    for (const exchange of this._exchanges.values()) {
      exchange.clear();
    }
    this._exchanges.clear();
    this._queues.clear();
  }
}

// =============================================================================
// Routed Queue Manager
// =============================================================================

/**
 * A queue manager with built-in routing support.
 *
 * @example
 * const manager = new RoutedQueueManager();
 *
 * // Create queues
 * const errorsQueue = await manager.createQueue('errors');
 * const allLogsQueue = await manager.createQueue('all-logs');
 *
 * // Set up routing
 * manager.declareExchange('logs', 'topic');
 * manager.bindTopic('logs', 'errors', 'logs.error');
 * manager.bindTopic('logs', 'all-logs', 'logs.#');
 *
 * // Publish with routing
 * await manager.publish('logs', link, 'logs.error');
 * // Message is routed to both 'errors' and 'all-logs' queues
 */
export class RoutedQueueManager {
  /**
   * Creates a new RoutedQueueManager.
   *
   * @param {import('../queue/memory-queue.js').MemoryQueueManager} queueManager - Underlying queue manager
   */
  constructor(queueManager) {
    /**
     * The underlying queue manager.
     * @type {import('../queue/memory-queue.js').MemoryQueueManager}
     * @private
     */
    this._queueManager = queueManager;

    /**
     * The router.
     * @type {Router}
     * @private
     */
    this._router = new Router();
  }

  /**
   * Creates a queue.
   *
   * @param {string} name - Queue name
   * @param {import('../queue/types.ts').QueueOptions} [options] - Queue options
   * @returns {Promise<import('../queue/queue.js').LinksQueue>}
   */
  async createQueue(name, options) {
    const queue = await this._queueManager.createQueue(name, options);
    this._router.registerQueue(name);
    return queue;
  }

  /**
   * Gets a queue by name.
   *
   * @param {string} name - Queue name
   * @returns {Promise<import('../queue/queue.js').LinksQueue | null>}
   */
  async getQueue(name) {
    return this._queueManager.getQueue(name);
  }

  /**
   * Deletes a queue.
   *
   * @param {string} name - Queue name
   * @returns {Promise<boolean>}
   */
  async deleteQueue(name) {
    this._router.unregisterQueue(name);
    return this._queueManager.deleteQueue(name);
  }

  /**
   * Lists all queues.
   *
   * @returns {Promise<import('../queue/types.ts').QueueInfo[]>}
   */
  async listQueues() {
    return this._queueManager.listQueues();
  }

  /**
   * Declares an exchange.
   *
   * @param {string} name - Exchange name
   * @param {'direct' | 'topic' | 'fanout' | 'headers'} type - Exchange type
   * @returns {DirectExchange | TopicExchange | FanoutExchange | HeadersExchange}
   */
  declareExchange(name, type) {
    return this._router.declareExchange(name, type);
  }

  /**
   * Gets an exchange.
   *
   * @param {string} name - Exchange name
   * @returns {DirectExchange | TopicExchange | FanoutExchange | HeadersExchange | undefined}
   */
  getExchange(name) {
    return this._router.getExchange(name);
  }

  /**
   * Deletes an exchange.
   *
   * @param {string} name - Exchange name
   * @returns {boolean}
   */
  deleteExchange(name) {
    return this._router.deleteExchange(name);
  }

  /**
   * Binds a topic pattern.
   *
   * @param {string} exchange - Exchange name
   * @param {string} queue - Queue name
   * @param {string} pattern - Topic pattern
   * @returns {Binding}
   */
  bindTopic(exchange, queue, pattern) {
    return this._router.bind(exchange, queue, pattern);
  }

  /**
   * Unbinds a topic pattern.
   *
   * @param {string} exchange - Exchange name
   * @param {string} queue - Queue name
   * @param {string} pattern - Topic pattern
   * @returns {boolean}
   */
  unbindTopic(exchange, queue, pattern) {
    return this._router.unbind(exchange, queue, pattern);
  }

  /**
   * Sets up fanout routing.
   *
   * @param {string} exchange - Exchange name
   * @param {string[]} queues - Queue names
   */
  fanout(exchange, queues) {
    this._router.declareExchange(exchange, ExchangeType.FANOUT);
    for (const queue of queues) {
      this._router.bind(exchange, queue);
    }
  }

  /**
   * Publishes a message through an exchange.
   *
   * @param {string} exchange - Exchange name
   * @param {import('../index.d.ts').Link} link - The link to publish
   * @param {string} [routingKey=''] - Routing key
   * @param {Object} [headers={}] - Message headers
   * @returns {Promise<string[]>} Array of queue names that received the message
   */
  async publish(exchange, link, routingKey = '', headers = {}) {
    const queues = this._router.route(exchange, routingKey, headers);

    for (const queueName of queues) {
      const queue = await this._queueManager.getQueue(queueName);
      if (queue) {
        await queue.enqueue(link);
      }
    }

    return queues;
  }

  /**
   * Gets the router.
   *
   * @returns {Router}
   */
  getRouter() {
    return this._router;
  }

  /**
   * Clears all routing state.
   */
  clear() {
    this._router.clear();
  }
}
