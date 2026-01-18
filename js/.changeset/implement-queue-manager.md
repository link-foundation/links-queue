---
'links-queue-js': minor
---

Add LinksQueue and MemoryQueueManager implementations

- Implement `LinksQueue` class with FIFO ordering, visibility timeout, at-least-once delivery, acknowledgment/rejection, and dead letter queue support
- Implement `MemoryQueueManager` for managing named queues with create/delete/get/list operations
- Implement `DeliveryTracker` for in-flight item tracking with visibility timeouts and retry counting
- Add TypeScript declarations for all new modules
- Add comprehensive tests (50+ tests for queue implementation)
