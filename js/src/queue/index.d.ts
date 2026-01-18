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

// Delivery tracking
export {
  DeliveryState,
  DeliveryStateValue,
  DeliveryRecord,
  DeliveryTracker,
  DeliveryTrackerOptions,
  InFlightItem,
  PollableDeliveryTracker,
  RejectResult,
} from './delivery.d.ts';

// Queue implementations
export { LinksQueue, LinksQueueConfig } from './queue.d.ts';
export { MemoryQueue, MemoryQueueWithStorage } from './memory-queue.d.ts';

// Queue managers
export {
  MemoryQueueManager,
  LinksQueueManager,
  LinksQueueManagerConfig,
} from './manager.d.ts';
