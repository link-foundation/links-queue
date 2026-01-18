/**
 * Queue module for links-queue.
 *
 * This module exports the Queue and QueueManager interfaces and related types
 * for message queue operations built on top of the Link data model.
 *
 * @module queue
 */

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

export {
  DeliveryState,
  DeliveryStateValue,
  DeliveryRecord,
  DeliveryTracker,
  RejectResult,
} from './delivery.d.ts';

export { MemoryQueue, MemoryQueueWithStorage } from './memory-queue.d.ts';

export { MemoryQueueManager } from './manager.d.ts';
