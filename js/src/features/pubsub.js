/**
 * Pub/Sub module for links-queue.
 *
 * This module provides publish/subscribe messaging patterns:
 * - Topic creation/deletion
 * - Subscribe/unsubscribe
 * - Fan-out delivery
 * - Message filtering
 *
 * @module features/pubsub
 *
 * @see REQUIREMENTS.md - Feature Parity with Competitors
 * @see ROADMAP.md - Phase 7: Advanced Features
 */

// =============================================================================
// Subscription
// =============================================================================

/**
 * Represents an active subscription.
 *
 * @typedef {Object} Subscription
 * @property {string} id - Unique subscription identifier
 * @property {string} topic - Topic name
 * @property {string} [pattern] - Optional filter pattern
 * @property {(message: PublishedMessage) => Promise<void>} handler - Message handler
 * @property {boolean} active - Whether the subscription is active
 * @property {number} created - Creation timestamp
 * @property {number} received - Number of messages received
 */

// =============================================================================
// Published Message
// =============================================================================

/**
 * Represents a published message.
 *
 * @typedef {Object} PublishedMessage
 * @property {string} id - Unique message identifier
 * @property {string} topic - Topic the message was published to
 * @property {import('../index.d.ts').Link} link - The link data
 * @property {number} timestamp - Publication timestamp
 * @property {Object} [headers] - Optional message headers
 */

// =============================================================================
// Topic
// =============================================================================

/**
 * Represents a topic for pub/sub messaging.
 *
 * @typedef {Object} Topic
 * @property {string} name - Topic name
 * @property {number} created - Creation timestamp
 * @property {number} messageCount - Total messages published
 * @property {number} subscriberCount - Current number of subscribers
 */

// =============================================================================
// Message Filter
// =============================================================================

/**
 * Filter for messages based on content.
 *
 * @example
 * const filter = new MessageFilter();
 *
 * // Match by source
 * filter.matches({ source: 'user' }, { source: 'user', target: 'created' }); // true
 *
 * // Match by pattern
 * filter.matches({ source: /^user/ }, { source: 'user-123', target: 'created' }); // true
 */
export class MessageFilter {
  /**
   * Checks if a link matches a filter pattern.
   *
   * @param {Object} pattern - Filter pattern
   * @param {import('../index.d.ts').Link} link - The link to check
   * @returns {boolean} True if the link matches
   */
  static matches(pattern, link) {
    for (const [key, value] of Object.entries(pattern)) {
      const linkValue = link[key];

      if (value instanceof RegExp) {
        if (!value.test(String(linkValue))) {
          return false;
        }
      } else if (typeof value === 'function') {
        if (!value(linkValue)) {
          return false;
        }
      } else if (linkValue !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Creates a filter function from a pattern.
   *
   * @param {Object} pattern - Filter pattern
   * @returns {(link: import('../index.d.ts').Link) => boolean}
   */
  static createFilter(pattern) {
    return (link) => this.matches(pattern, link);
  }
}

// =============================================================================
// Pub/Sub Broker
// =============================================================================

/**
 * Central broker for pub/sub messaging.
 *
 * Manages topics, subscriptions, and message delivery.
 *
 * @example
 * const broker = new PubSubBroker();
 *
 * // Create a topic
 * broker.createTopic('events');
 *
 * // Subscribe to the topic
 * const sub = broker.subscribe('events', async (message) => {
 *   console.log('Received:', message.link);
 * });
 *
 * // Publish a message
 * await broker.publish('events', { id: 1, source: 'user', target: 'created' });
 *
 * // Unsubscribe
 * broker.unsubscribe(sub.id);
 */
export class PubSubBroker {
  /**
   * Creates a new PubSubBroker.
   *
   * @param {Object} [options] - Broker options
   * @param {boolean} [options.autoCreateTopics=true] - Automatically create topics on publish
   * @param {number} [options.messageRetention=0] - Message retention in ms (0 = no retention)
   */
  constructor(options = {}) {
    /**
     * Auto-create topics flag.
     * @type {boolean}
     * @private
     */
    this._autoCreateTopics = options.autoCreateTopics ?? true;

    /**
     * Message retention period.
     * @type {number}
     * @private
     */
    this._messageRetention = options.messageRetention ?? 0;

    /**
     * Topics by name.
     * @type {Map<string, Topic>}
     * @private
     */
    this._topics = new Map();

    /**
     * Subscriptions by ID.
     * @type {Map<string, Subscription>}
     * @private
     */
    this._subscriptions = new Map();

    /**
     * Subscriptions grouped by topic.
     * @type {Map<string, Set<string>>}
     * @private
     */
    this._topicSubscriptions = new Map();

    /**
     * Message history (if retention enabled).
     * @type {Map<string, PublishedMessage[]>}
     * @private
     */
    this._messageHistory = new Map();

    /**
     * ID counter.
     * @type {number}
     * @private
     */
    this._idCounter = 0;

    /**
     * Statistics.
     * @type {{published: number, delivered: number, filtered: number}}
     * @private
     */
    this._stats = {
      published: 0,
      delivered: 0,
      filtered: 0,
    };
  }

  /**
   * Generates a unique ID.
   *
   * @returns {string}
   * @private
   */
  _generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${++this._idCounter}`;
  }

  /**
   * Creates a new topic.
   *
   * @param {string} name - Topic name
   * @returns {Topic} The created topic
   * @throws {Error} If topic already exists
   */
  createTopic(name) {
    if (this._topics.has(name)) {
      throw new Error(`Topic '${name}' already exists`);
    }

    const topic = {
      name,
      created: Date.now(),
      messageCount: 0,
      subscriberCount: 0,
    };

    this._topics.set(name, topic);
    this._topicSubscriptions.set(name, new Set());

    if (this._messageRetention > 0) {
      this._messageHistory.set(name, []);
    }

    return topic;
  }

  /**
   * Gets a topic by name.
   *
   * @param {string} name - Topic name
   * @returns {Topic|undefined}
   */
  getTopic(name) {
    return this._topics.get(name);
  }

  /**
   * Deletes a topic and all its subscriptions.
   *
   * @param {string} name - Topic name
   * @returns {boolean} True if the topic was deleted
   */
  deleteTopic(name) {
    const topic = this._topics.get(name);
    if (!topic) {
      return false;
    }

    // Remove all subscriptions for this topic
    const subIds = this._topicSubscriptions.get(name);
    if (subIds) {
      for (const subId of subIds) {
        this._subscriptions.delete(subId);
      }
    }

    this._topicSubscriptions.delete(name);
    this._messageHistory.delete(name);
    this._topics.delete(name);

    return true;
  }

  /**
   * Lists all topics.
   *
   * @returns {Topic[]}
   */
  listTopics() {
    return [...this._topics.values()];
  }

  /**
   * Subscribes to a topic.
   *
   * @param {string} topic - Topic name
   * @param {(message: PublishedMessage) => Promise<void>} handler - Message handler
   * @param {Object} [options] - Subscription options
   * @param {Object} [options.filter] - Filter pattern for messages
   * @returns {Subscription} The created subscription
   *
   * @example
   * // Subscribe to all messages
   * const sub1 = broker.subscribe('events', async (msg) => {
   *   console.log('Event:', msg.link);
   * });
   *
   * // Subscribe with filter
   * const sub2 = broker.subscribe('events', handler, {
   *   filter: { source: 'user' }
   * });
   */
  subscribe(topic, handler, options = {}) {
    // Auto-create topic if enabled
    if (!this._topics.has(topic)) {
      if (this._autoCreateTopics) {
        this.createTopic(topic);
      } else {
        throw new Error(`Topic '${topic}' does not exist`);
      }
    }

    const subscription = {
      id: this._generateId('sub'),
      topic,
      pattern: options.filter || null,
      handler,
      active: true,
      created: Date.now(),
      received: 0,
    };

    this._subscriptions.set(subscription.id, subscription);
    this._topicSubscriptions.get(topic).add(subscription.id);

    // Update topic subscriber count
    const topicInfo = this._topics.get(topic);
    topicInfo.subscriberCount++;

    return subscription;
  }

  /**
   * Unsubscribes from a topic.
   *
   * @param {string} subscriptionId - Subscription ID
   * @returns {boolean} True if the subscription was removed
   */
  unsubscribe(subscriptionId) {
    const subscription = this._subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    // Remove from topic's subscription set
    const topicSubs = this._topicSubscriptions.get(subscription.topic);
    if (topicSubs) {
      topicSubs.delete(subscriptionId);
    }

    // Update topic subscriber count
    const topicInfo = this._topics.get(subscription.topic);
    if (topicInfo) {
      topicInfo.subscriberCount--;
    }

    this._subscriptions.delete(subscriptionId);
    return true;
  }

  /**
   * Pauses a subscription.
   *
   * @param {string} subscriptionId - Subscription ID
   * @returns {boolean} True if the subscription was paused
   */
  pause(subscriptionId) {
    const subscription = this._subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.active = false;
      return true;
    }
    return false;
  }

  /**
   * Resumes a subscription.
   *
   * @param {string} subscriptionId - Subscription ID
   * @returns {boolean} True if the subscription was resumed
   */
  resume(subscriptionId) {
    const subscription = this._subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.active = true;
      return true;
    }
    return false;
  }

  /**
   * Gets a subscription by ID.
   *
   * @param {string} subscriptionId - Subscription ID
   * @returns {Subscription|undefined}
   */
  getSubscription(subscriptionId) {
    return this._subscriptions.get(subscriptionId);
  }

  /**
   * Lists all subscriptions for a topic.
   *
   * @param {string} [topic] - Optional topic to filter by
   * @returns {Subscription[]}
   */
  listSubscriptions(topic) {
    if (topic) {
      const subIds = this._topicSubscriptions.get(topic);
      if (subIds) {
        return [...subIds]
          .map((id) => this._subscriptions.get(id))
          .filter(Boolean);
      }
      return [];
    }
    return [...this._subscriptions.values()];
  }

  /**
   * Publishes a message to a topic.
   *
   * @param {string} topic - Topic name
   * @param {import('../index.d.ts').Link} link - The link to publish
   * @param {Object} [headers={}] - Optional message headers
   * @returns {Promise<{delivered: number, filtered: number}>} Delivery result
   *
   * @example
   * await broker.publish('events', { id: 1, source: 'user', target: 'created' });
   *
   * // With headers
   * await broker.publish('events', link, { priority: 'high' });
   */
  async publish(topic, link, headers = {}) {
    // Auto-create topic if enabled
    if (!this._topics.has(topic)) {
      if (this._autoCreateTopics) {
        this.createTopic(topic);
      } else {
        throw new Error(`Topic '${topic}' does not exist`);
      }
    }

    const message = {
      id: this._generateId('msg'),
      topic,
      link,
      timestamp: Date.now(),
      headers,
    };

    // Update topic stats
    const topicInfo = this._topics.get(topic);
    topicInfo.messageCount++;
    this._stats.published++;

    // Store in history if retention enabled
    if (this._messageRetention > 0) {
      const history = this._messageHistory.get(topic);
      if (history) {
        history.push(message);
        // Clean up old messages
        const cutoff = Date.now() - this._messageRetention;
        while (history.length > 0 && history[0].timestamp < cutoff) {
          history.shift();
        }
      }
    }

    // Deliver to subscribers
    let delivered = 0;
    let filtered = 0;

    const subIds = this._topicSubscriptions.get(topic);
    if (subIds) {
      for (const subId of subIds) {
        const subscription = this._subscriptions.get(subId);
        if (!subscription || !subscription.active) {
          continue;
        }

        // Check filter
        if (
          subscription.pattern &&
          !MessageFilter.matches(subscription.pattern, link)
        ) {
          filtered++;
          this._stats.filtered++;
          continue;
        }

        // Deliver message
        try {
          await subscription.handler(message);
          subscription.received++;
          delivered++;
          this._stats.delivered++;
        } catch (error) {
          console.error(`Error delivering to subscription ${subId}:`, error);
        }
      }
    }

    return { delivered, filtered };
  }

  /**
   * Publishes to multiple topics.
   *
   * @param {string[]} topics - Topic names
   * @param {import('../index.d.ts').Link} link - The link to publish
   * @param {Object} [headers={}] - Optional message headers
   * @returns {Promise<Map<string, {delivered: number, filtered: number}>>}
   */
  async publishMany(topics, link, headers = {}) {
    const results = new Map();

    for (const topic of topics) {
      const result = await this.publish(topic, link, headers);
      results.set(topic, result);
    }

    return results;
  }

  /**
   * Gets recent messages for a topic (if retention enabled).
   *
   * @param {string} topic - Topic name
   * @param {number} [limit=100] - Maximum messages to return
   * @returns {PublishedMessage[]}
   */
  getHistory(topic, limit = 100) {
    const history = this._messageHistory.get(topic);
    if (!history) {
      return [];
    }
    return history.slice(-limit);
  }

  /**
   * Gets broker statistics.
   *
   * @returns {{topics: number, subscriptions: number, published: number, delivered: number, filtered: number}}
   */
  getStats() {
    return {
      topics: this._topics.size,
      subscriptions: this._subscriptions.size,
      ...this._stats,
    };
  }

  /**
   * Clears all state.
   */
  clear() {
    this._topics.clear();
    this._subscriptions.clear();
    this._topicSubscriptions.clear();
    this._messageHistory.clear();
    this._stats = {
      published: 0,
      delivered: 0,
      filtered: 0,
    };
  }
}

// =============================================================================
// Observable Queue
// =============================================================================

/**
 * A queue that supports pub/sub-style subscriptions.
 *
 * Wraps an existing queue and emits events when items are enqueued/dequeued.
 *
 * @example
 * const baseQueue = new LinksQueue({ name: 'tasks', store });
 * const observableQueue = new ObservableQueue(baseQueue);
 *
 * // Subscribe to enqueue events
 * observableQueue.onEnqueue(async (link) => {
 *   console.log('New item:', link);
 * });
 *
 * // Subscribe to dequeue events
 * observableQueue.onDequeue(async (link) => {
 *   console.log('Processing:', link);
 * });
 */
export class ObservableQueue {
  /**
   * Creates a new ObservableQueue.
   *
   * @param {import('../queue/queue.js').LinksQueue} queue - The underlying queue
   */
  constructor(queue) {
    /**
     * The underlying queue.
     * @type {import('../queue/queue.js').LinksQueue}
     * @private
     */
    this._queue = queue;

    /**
     * Enqueue handlers.
     * @type {Set<(link: import('../index.d.ts').Link) => Promise<void>>}
     * @private
     */
    this._enqueueHandlers = new Set();

    /**
     * Dequeue handlers.
     * @type {Set<(link: import('../index.d.ts').Link) => Promise<void>>}
     * @private
     */
    this._dequeueHandlers = new Set();

    /**
     * Acknowledge handlers.
     * @type {Set<(id: import('../index.d.ts').LinkId) => Promise<void>>}
     * @private
     */
    this._acknowledgeHandlers = new Set();

    /**
     * Reject handlers.
     * @type {Set<(id: import('../index.d.ts').LinkId, requeue: boolean) => Promise<void>>}
     * @private
     */
    this._rejectHandlers = new Set();
  }

  /**
   * Gets the queue name.
   *
   * @returns {string}
   */
  get name() {
    return this._queue.name;
  }

  /**
   * Subscribes to enqueue events.
   *
   * @param {(link: import('../index.d.ts').Link) => Promise<void>} handler - Event handler
   * @returns {() => void} Unsubscribe function
   */
  onEnqueue(handler) {
    this._enqueueHandlers.add(handler);
    return () => this._enqueueHandlers.delete(handler);
  }

  /**
   * Subscribes to dequeue events.
   *
   * @param {(link: import('../index.d.ts').Link) => Promise<void>} handler - Event handler
   * @returns {() => void} Unsubscribe function
   */
  onDequeue(handler) {
    this._dequeueHandlers.add(handler);
    return () => this._dequeueHandlers.delete(handler);
  }

  /**
   * Subscribes to acknowledge events.
   *
   * @param {(id: import('../index.d.ts').LinkId) => Promise<void>} handler - Event handler
   * @returns {() => void} Unsubscribe function
   */
  onAcknowledge(handler) {
    this._acknowledgeHandlers.add(handler);
    return () => this._acknowledgeHandlers.delete(handler);
  }

  /**
   * Subscribes to reject events.
   *
   * @param {(id: import('../index.d.ts').LinkId, requeue: boolean) => Promise<void>} handler - Event handler
   * @returns {() => void} Unsubscribe function
   */
  onReject(handler) {
    this._rejectHandlers.add(handler);
    return () => this._rejectHandlers.delete(handler);
  }

  /**
   * Enqueues a link and notifies subscribers.
   *
   * @param {import('../index.d.ts').Link} link - The link to enqueue
   * @returns {Promise<import('../queue/types.ts').EnqueueResult>}
   */
  async enqueue(link) {
    const result = await this._queue.enqueue(link);

    // Notify handlers
    for (const handler of this._enqueueHandlers) {
      try {
        await handler(link);
      } catch (error) {
        console.error('Enqueue handler error:', error);
      }
    }

    return result;
  }

  /**
   * Dequeues and notifies subscribers.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async dequeue() {
    const link = await this._queue.dequeue();

    if (link) {
      // Notify handlers
      for (const handler of this._dequeueHandlers) {
        try {
          await handler(link);
        } catch (error) {
          console.error('Dequeue handler error:', error);
        }
      }
    }

    return link;
  }

  /**
   * Peeks at the next item.
   *
   * @returns {Promise<import('../index.d.ts').Link | null>}
   */
  async peek() {
    return this._queue.peek();
  }

  /**
   * Acknowledges and notifies subscribers.
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   */
  async acknowledge(id) {
    await this._queue.acknowledge(id);

    // Notify handlers
    for (const handler of this._acknowledgeHandlers) {
      try {
        await handler(id);
      } catch (error) {
        console.error('Acknowledge handler error:', error);
      }
    }
  }

  /**
   * Rejects and notifies subscribers.
   *
   * @param {import('../index.d.ts').LinkId} id - Item ID
   * @param {boolean} [requeue=false] - Whether to requeue
   */
  async reject(id, requeue = false) {
    await this._queue.reject(id, requeue);

    // Notify handlers
    for (const handler of this._rejectHandlers) {
      try {
        await handler(id, requeue);
      } catch (error) {
        console.error('Reject handler error:', error);
      }
    }
  }

  /**
   * Gets queue statistics.
   *
   * @returns {import('../queue/types.ts').QueueStats}
   */
  getStats() {
    return this._queue.getStats();
  }

  /**
   * Gets the queue depth.
   *
   * @returns {number}
   */
  getDepth() {
    return this._queue.getDepth();
  }

  /**
   * Clears the queue and removes all handlers.
   */
  async clear() {
    this._enqueueHandlers.clear();
    this._dequeueHandlers.clear();
    this._acknowledgeHandlers.clear();
    this._rejectHandlers.clear();
    await this._queue.clear();
  }
}

// =============================================================================
// Queue-backed Pub/Sub
// =============================================================================

/**
 * Pub/Sub implementation backed by queues for durability.
 *
 * Each subscription gets its own queue for message persistence.
 *
 * @example
 * const pubsub = new QueueBackedPubSub(queueManager);
 *
 * // Create a subscription with a queue
 * const sub = await pubsub.subscribe('events', 'events-consumer-1', async (msg) => {
 *   console.log('Received:', msg);
 * });
 *
 * // Publish (message is enqueued to all subscriber queues)
 * await pubsub.publish('events', link);
 *
 * // Start processing (dequeues and processes messages)
 * await pubsub.startConsumer(sub.id);
 */
export class QueueBackedPubSub {
  /**
   * Creates a new QueueBackedPubSub.
   *
   * @param {import('../queue/memory-queue.js').MemoryQueueManager} queueManager - Queue manager
   */
  constructor(queueManager) {
    /**
     * Queue manager.
     * @type {import('../queue/memory-queue.js').MemoryQueueManager}
     * @private
     */
    this._queueManager = queueManager;

    /**
     * Topics with their subscriber queues.
     * @type {Map<string, Set<string>>}
     * @private
     */
    this._topics = new Map();

    /**
     * Subscriptions by ID.
     * @type {Map<string, {id: string, topic: string, queueName: string, handler: Function, active: boolean, consumerHandle: NodeJS.Timeout|null}>}
     * @private
     */
    this._subscriptions = new Map();

    /**
     * ID counter.
     * @type {number}
     * @private
     */
    this._idCounter = 0;
  }

  /**
   * Creates a topic.
   *
   * @param {string} name - Topic name
   * @returns {boolean} True if created, false if already exists
   */
  createTopic(name) {
    if (this._topics.has(name)) {
      return false;
    }
    this._topics.set(name, new Set());
    return true;
  }

  /**
   * Deletes a topic.
   *
   * @param {string} name - Topic name
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteTopic(name) {
    const subscribers = this._topics.get(name);
    if (!subscribers) {
      return false;
    }

    // Remove all subscriptions and their queues
    for (const queueName of subscribers) {
      // Find subscription for this queue
      for (const [subId, sub] of this._subscriptions) {
        if (sub.queueName === queueName) {
          await this.unsubscribe(subId);
          break;
        }
      }
    }

    this._topics.delete(name);
    return true;
  }

  /**
   * Subscribes to a topic with a dedicated queue.
   *
   * @param {string} topic - Topic name
   * @param {string} subscriberId - Unique subscriber identifier
   * @param {(message: import('../index.d.ts').Link) => Promise<void>} handler - Message handler
   * @returns {Promise<{id: string, queueName: string}>}
   */
  async subscribe(topic, subscriberId, handler) {
    // Create topic if not exists
    if (!this._topics.has(topic)) {
      this._topics.set(topic, new Set());
    }

    // Create a dedicated queue for this subscriber
    const queueName = `${topic}-${subscriberId}`;
    await this._queueManager.createQueue(queueName);

    // Register the queue with the topic
    this._topics.get(topic).add(queueName);

    // Create subscription record
    const subId = `sub_${++this._idCounter}`;
    const subscription = {
      id: subId,
      topic,
      queueName,
      handler,
      active: false,
      consumerHandle: null,
    };

    this._subscriptions.set(subId, subscription);

    return { id: subId, queueName };
  }

  /**
   * Unsubscribes and removes the dedicated queue.
   *
   * @param {string} subscriptionId - Subscription ID
   * @returns {Promise<boolean>}
   */
  async unsubscribe(subscriptionId) {
    const subscription = this._subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    // Stop consumer
    this.stopConsumer(subscriptionId);

    // Remove queue from topic
    const topicQueues = this._topics.get(subscription.topic);
    if (topicQueues) {
      topicQueues.delete(subscription.queueName);
    }

    // Delete the queue
    await this._queueManager.deleteQueue(subscription.queueName);

    this._subscriptions.delete(subscriptionId);
    return true;
  }

  /**
   * Publishes to a topic (enqueues to all subscriber queues).
   *
   * @param {string} topic - Topic name
   * @param {import('../index.d.ts').Link} link - The link to publish
   * @returns {Promise<number>} Number of queues that received the message
   */
  async publish(topic, link) {
    const subscribers = this._topics.get(topic);
    if (!subscribers || subscribers.size === 0) {
      return 0;
    }

    let count = 0;
    for (const queueName of subscribers) {
      const queue = await this._queueManager.getQueue(queueName);
      if (queue) {
        await queue.enqueue(link);
        count++;
      }
    }

    return count;
  }

  /**
   * Starts consuming messages for a subscription.
   *
   * @param {string} subscriptionId - Subscription ID
   * @param {number} [pollInterval=100] - Poll interval in ms
   */
  async startConsumer(subscriptionId, pollInterval = 100) {
    const subscription = this._subscriptions.get(subscriptionId);
    if (!subscription || subscription.active) {
      return;
    }

    subscription.active = true;

    const consume = async () => {
      if (!subscription.active) {
        return;
      }

      const queue = await this._queueManager.getQueue(subscription.queueName);
      if (queue) {
        const link = await queue.dequeue();
        if (link) {
          try {
            await subscription.handler(link);
            await queue.acknowledge(link.id);
          } catch (error) {
            console.error('Consumer error:', error);
            await queue.reject(link.id, true);
          }
        }
      }

      // Check active again after async operations to avoid timer leak
      if (!subscription.active) {
        return;
      }

      subscription.consumerHandle = globalThis.setTimeout(
        consume,
        pollInterval
      );
    };

    consume();
  }

  /**
   * Stops consuming messages for a subscription.
   *
   * @param {string} subscriptionId - Subscription ID
   */
  stopConsumer(subscriptionId) {
    const subscription = this._subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    subscription.active = false;
    if (subscription.consumerHandle) {
      globalThis.clearTimeout(subscription.consumerHandle);
      subscription.consumerHandle = null;
    }
  }

  /**
   * Lists all topics.
   *
   * @returns {Array<{name: string, subscribers: number}>}
   */
  listTopics() {
    return [...this._topics.entries()].map(([name, subs]) => ({
      name,
      subscribers: subs.size,
    }));
  }

  /**
   * Lists subscriptions for a topic.
   *
   * @param {string} [topic] - Optional topic filter
   * @returns {Array<{id: string, topic: string, queueName: string, active: boolean}>}
   */
  listSubscriptions(topic) {
    let subs = [...this._subscriptions.values()];
    if (topic) {
      subs = subs.filter((s) => s.topic === topic);
    }
    return subs.map((s) => ({
      id: s.id,
      topic: s.topic,
      queueName: s.queueName,
      active: s.active,
    }));
  }

  /**
   * Clears all state.
   */
  async clear() {
    // Stop all consumers
    for (const subId of this._subscriptions.keys()) {
      this.stopConsumer(subId);
    }

    // Delete all subscription queues
    for (const subscription of this._subscriptions.values()) {
      await this._queueManager.deleteQueue(subscription.queueName);
    }

    this._topics.clear();
    this._subscriptions.clear();
  }
}
