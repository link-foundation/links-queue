---
'links-queue-js': minor
---

Implement Queue and QueueManager for JavaScript

- Add `MemoryQueue` class for FIFO queue with visibility timeout
- Add `MemoryQueueWithStorage` wrapper for proper requeue support
- Add `MemoryQueueManager` for queue lifecycle management
- Add `DeliveryTracker`, `DeliveryRecord`, and `DeliveryState` for delivery tracking
- Support at-least-once delivery guarantee with retry limits
- Support dead letter queue routing for failed messages
- Full API parity with Rust implementation
