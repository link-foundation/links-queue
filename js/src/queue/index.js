/**
 * Queue module for links-queue.
 *
 * This module exports the Queue and QueueManager interfaces and related types
 * for message queue operations built on top of the Link data model.
 *
 * @module queue
 */

// Re-export the QueueError class for runtime usage
export { QueueError } from './types.js';

// Export the Queue implementation
export { LinksQueue } from './queue.js';

// Export the QueueManager implementation
export { MemoryQueueManager } from './manager.js';

// Export the DeliveryTracker for advanced usage
export { DeliveryTracker } from './delivery.js';
