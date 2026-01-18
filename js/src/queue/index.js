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

// Export delivery tracking
export {
  DeliveryState,
  DeliveryRecord,
  DeliveryTracker,
  PollableDeliveryTracker,
} from './delivery.js';

// Export queue implementations
export { LinksQueue } from './queue.js';
export { MemoryQueue, MemoryQueueWithStorage } from './memory-queue.js';

// Export queue managers
export { MemoryQueueManager, LinksQueueManager } from './manager.js';
