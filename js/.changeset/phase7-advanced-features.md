---
'links-queue-js': minor
---

Add Phase 7 advanced queue features

- **Scheduling**: Implement `CronParser`, `Scheduler`, and `ScheduledQueue` for delayed messages, cron jobs, TTL, and message expiration
- **Rate Limiting**: Implement `SlidingWindowCounter`, `TokenBucket`, `RateLimiter`, and `RateLimitedQueue` with sliding window algorithm
- **Routing**: Implement `TopicMatcher`, `DirectExchange`, `TopicExchange`, `FanoutExchange`, `HeadersExchange`, `Router`, and `RoutedQueueManager` for topic-based routing with AMQP-style wildcards
- **Pub/Sub**: Implement `MessageFilter`, `PubSubBroker`, `ObservableQueue`, and `QueueBackedPubSub` for publish/subscribe patterns with message filtering
