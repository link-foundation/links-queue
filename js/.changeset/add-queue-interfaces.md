---
'links-queue-js': minor
---

Add Queue and QueueManager interfaces (API Contract)

Phase 2 implementation defining the complete queue API contract:

- Queue interface with enqueue, dequeue, peek, acknowledge, reject operations
- QueueManager interface for queue lifecycle management
- EnqueueResult, QueueStats, QueueOptions, QueueInfo types
- QueueError class with typed error codes
- QueueHandler and QueueSubscription types for consumer patterns

This establishes the API contract that implementations must follow.
