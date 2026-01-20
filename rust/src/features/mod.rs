//! Advanced Queue Features (Phase 7)
//!
//! This module provides advanced queue functionality including:
//! - **Scheduling**: Delayed messages, cron jobs, TTL, message expiration
//! - **Rate Limiting**: Per-queue and per-consumer limits with sliding window algorithm
//! - **Routing**: Topic-based routing with AMQP-style wildcards
//! - **Pub/Sub**: Publish/subscribe patterns with message filtering
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::features::{Scheduler, RateLimiter, Router, PubSubBroker};
//!
//! // Create a scheduler for delayed messages
//! let scheduler = Scheduler::new();
//!
//! // Create a rate limiter
//! let limiter = RateLimiter::new(100, Duration::from_secs(60));
//!
//! // Create a router for topic-based routing
//! let router = Router::new();
//!
//! // Create a pub/sub broker
//! let broker = PubSubBroker::new();
//! ```

pub mod scheduler;
pub mod rate_limiter;
pub mod router;
pub mod pubsub;

#[cfg(test)]
mod scheduler_tests;
#[cfg(test)]
mod router_tests;
#[cfg(test)]
mod pubsub_tests;

// Re-export main types
pub use scheduler::{CronParser, CronSchedule, Scheduler, ScheduledItem, ScheduledQueue, SchedulerStats, CronJob};
pub use rate_limiter::{
    SlidingWindowCounter, TokenBucket, RateLimiter, RateLimitedQueue,
    RateLimitResult, RateLimitError, RateLimitStats,
};
pub use router::{
    ExchangeType, TopicMatcher, Exchange, DirectExchange, TopicExchange,
    FanoutExchange, HeadersExchange, Router, RoutedQueueManager, Binding,
};
pub use pubsub::{
    MessageFilter, PubSubBroker, Subscription, Topic, TopicInfo,
    ObservableQueue, QueueEvent, PubSubStats,
};
