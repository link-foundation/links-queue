/**
 * Queue module for links-queue.
 *
 * This module exports the Queue and QueueManager interfaces and related types
 * for message queue operations built on top of the Link data model.
 *
 * @module queue
 */

// Type definitions
export {
  EnqueueResult,
  QueueStats,
  QueueOptions,
  Queue,
  QueueInfo,
  QueueManager,
  QueueErrorCode,
  QueueError,
  QueueHandler,
  QueueSubscription,
} from './types.ts';

// Queue implementation
export { LinksQueue, LinksQueueConfig } from './queue.d.ts';

// QueueManager implementation
export { MemoryQueueManager, MemoryQueueManagerConfig } from './manager.d.ts';

// Delivery tracking
export {
  DeliveryTracker,
  DeliveryTrackerOptions,
  InFlightItem,
} from './delivery.d.ts';
