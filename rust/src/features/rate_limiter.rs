//! Rate Limiter module for per-queue and per-consumer rate limiting.
//!
//! This module provides rate limiting functionality:
//! - **Sliding Window Counter**: Count-based rate limiting with rolling window
//! - **Token Bucket**: Burst-friendly rate limiting with refilling tokens
//! - **Rate Limiter**: Multi-key rate limiting manager
//! - **Rate Limited Queue**: Queue wrapper with rate limiting
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::features::{RateLimiter, SlidingWindowCounter, TokenBucket};
//! use std::time::Duration;
//!
//! // Create a sliding window counter
//! let counter = SlidingWindowCounter::new(100, Duration::from_secs(60));
//!
//! // Create a token bucket
//! let bucket = TokenBucket::new(10, 1.0); // 10 capacity, 1 token/second
//!
//! // Create a multi-key rate limiter
//! let limiter = RateLimiter::sliding_window(100, Duration::from_secs(60));
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::{Link, LinkType, Queue, QueueError, QueueResult, QueueStats, EnqueueResult};

// =============================================================================
// Rate Limit Result
// =============================================================================

/// Result of a rate limit check.
#[derive(Debug, Clone)]
pub struct RateLimitResult {
    /// Whether the request is allowed
    pub allowed: bool,
    /// Current count/tokens used
    pub current: u64,
    /// Maximum allowed count/tokens
    pub limit: u64,
    /// Remaining count/tokens
    pub remaining: u64,
    /// Time until reset (in milliseconds)
    pub reset_in_ms: u64,
}

impl RateLimitResult {
    /// Creates a new allowed result.
    pub fn allowed(current: u64, limit: u64, remaining: u64, reset_in_ms: u64) -> Self {
        Self {
            allowed: true,
            current,
            limit,
            remaining,
            reset_in_ms,
        }
    }

    /// Creates a new denied result.
    pub fn denied(current: u64, limit: u64, reset_in_ms: u64) -> Self {
        Self {
            allowed: false,
            current,
            limit,
            remaining: 0,
            reset_in_ms,
        }
    }
}

// =============================================================================
// Rate Limit Error
// =============================================================================

/// Error returned when rate limit is exceeded.
#[derive(Debug, Clone)]
pub struct RateLimitError {
    /// Time until the rate limit resets (in milliseconds)
    pub retry_after_ms: u64,
    /// Maximum allowed requests
    pub limit: u64,
    /// Window size in milliseconds
    pub window_ms: u64,
    /// Error message
    pub message: String,
}

impl RateLimitError {
    /// Creates a new rate limit error.
    pub fn new(retry_after_ms: u64, limit: u64, window_ms: u64) -> Self {
        Self {
            retry_after_ms,
            limit,
            window_ms,
            message: format!(
                "Rate limit exceeded: {} requests per {}ms. Retry after {}ms",
                limit, window_ms, retry_after_ms
            ),
        }
    }
}

impl std::fmt::Display for RateLimitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RateLimitError {}

// =============================================================================
// Rate Limit Statistics
// =============================================================================

/// Statistics for rate limiting.
#[derive(Debug, Clone, Default)]
pub struct RateLimitStats {
    /// Current count or tokens
    pub current: u64,
    /// Maximum limit
    pub limit: u64,
    /// Remaining allowance
    pub remaining: u64,
    /// Time until reset (milliseconds)
    pub reset_in_ms: u64,
    /// Total number of allowed requests
    pub total_allowed: u64,
    /// Total number of denied requests
    pub total_denied: u64,
}

// =============================================================================
// Sliding Window Counter
// =============================================================================

/// A sliding window counter for rate limiting.
///
/// Uses a fixed window approach with interpolation for a smoother
/// sliding window effect. Simple and memory-efficient.
pub struct SlidingWindowCounter {
    /// Maximum requests per window
    limit: u64,
    /// Window duration
    window: Duration,
    /// Current window count
    current_count: AtomicU64,
    /// Previous window count
    previous_count: AtomicU64,
    /// Current window start time
    window_start: RwLock<Instant>,
    /// Statistics
    total_allowed: AtomicU64,
    total_denied: AtomicU64,
}

impl SlidingWindowCounter {
    /// Creates a new sliding window counter.
    ///
    /// # Arguments
    ///
    /// * `limit` - Maximum requests per window
    /// * `window` - Window duration
    pub fn new(limit: u64, window: Duration) -> Self {
        Self {
            limit,
            window,
            current_count: AtomicU64::new(0),
            previous_count: AtomicU64::new(0),
            window_start: RwLock::new(Instant::now()),
            total_allowed: AtomicU64::new(0),
            total_denied: AtomicU64::new(0),
        }
    }

    /// Updates window state if needed.
    fn update_window(&self) {
        let mut window_start = self.window_start.write().unwrap();
        let elapsed = window_start.elapsed();

        if elapsed >= self.window * 2 {
            // Both windows expired
            self.previous_count.store(0, Ordering::SeqCst);
            self.current_count.store(0, Ordering::SeqCst);
            *window_start = Instant::now();
        } else if elapsed >= self.window {
            // Current window expired, rotate
            let current = self.current_count.load(Ordering::SeqCst);
            self.previous_count.store(current, Ordering::SeqCst);
            self.current_count.store(0, Ordering::SeqCst);
            *window_start = *window_start + self.window;
        }
    }

    /// Calculates the weighted count using sliding window interpolation.
    fn weighted_count(&self) -> u64 {
        let window_start = self.window_start.read().unwrap();
        let elapsed = window_start.elapsed();

        let current = self.current_count.load(Ordering::SeqCst);
        let previous = self.previous_count.load(Ordering::SeqCst);

        // Weight previous window by how much of it is still in our sliding window
        let weight = if elapsed < self.window {
            1.0 - (elapsed.as_secs_f64() / self.window.as_secs_f64())
        } else {
            0.0
        };

        current + (previous as f64 * weight) as u64
    }

    /// Checks if a request is allowed without consuming.
    pub fn check(&self) -> RateLimitResult {
        self.update_window();
        let count = self.weighted_count();
        let reset_in_ms = self.time_to_reset();

        if count < self.limit {
            RateLimitResult::allowed(count, self.limit, self.limit - count, reset_in_ms)
        } else {
            RateLimitResult::denied(count, self.limit, reset_in_ms)
        }
    }

    /// Increments the counter.
    pub fn increment(&self) -> RateLimitResult {
        self.update_window();
        let new_count = self.current_count.fetch_add(1, Ordering::SeqCst) + 1;
        let total = self.weighted_count();
        let reset_in_ms = self.time_to_reset();

        RateLimitResult::allowed(
            total,
            self.limit,
            self.limit.saturating_sub(total),
            reset_in_ms,
        )
    }

    /// Checks and increments atomically.
    pub fn consume(&self) -> RateLimitResult {
        self.update_window();
        let count = self.weighted_count();
        let reset_in_ms = self.time_to_reset();

        if count < self.limit {
            self.current_count.fetch_add(1, Ordering::SeqCst);
            self.total_allowed.fetch_add(1, Ordering::SeqCst);
            let new_count = count + 1;
            RateLimitResult::allowed(
                new_count,
                self.limit,
                self.limit.saturating_sub(new_count),
                reset_in_ms,
            )
        } else {
            self.total_denied.fetch_add(1, Ordering::SeqCst);
            RateLimitResult::denied(count, self.limit, reset_in_ms)
        }
    }

    /// Resets the counter.
    pub fn reset(&self) {
        self.current_count.store(0, Ordering::SeqCst);
        self.previous_count.store(0, Ordering::SeqCst);
        let mut window_start = self.window_start.write().unwrap();
        *window_start = Instant::now();
    }

    /// Returns statistics.
    pub fn stats(&self) -> RateLimitStats {
        self.update_window();
        let count = self.weighted_count();

        RateLimitStats {
            current: count,
            limit: self.limit,
            remaining: self.limit.saturating_sub(count),
            reset_in_ms: self.time_to_reset(),
            total_allowed: self.total_allowed.load(Ordering::SeqCst),
            total_denied: self.total_denied.load(Ordering::SeqCst),
        }
    }

    fn time_to_reset(&self) -> u64 {
        let window_start = self.window_start.read().unwrap();
        let elapsed = window_start.elapsed();
        if elapsed < self.window {
            (self.window - elapsed).as_millis() as u64
        } else {
            0
        }
    }
}

// =============================================================================
// Token Bucket
// =============================================================================

/// A token bucket for burst-friendly rate limiting.
///
/// Allows bursts up to the bucket capacity, then limits to the refill rate.
pub struct TokenBucket {
    /// Maximum capacity
    capacity: u64,
    /// Tokens per second refill rate
    refill_rate: f64,
    /// Current token count (multiplied by 1000 for precision)
    tokens_millis: AtomicU64,
    /// Last refill time
    last_refill: RwLock<Instant>,
    /// Statistics
    total_allowed: AtomicU64,
    total_denied: AtomicU64,
}

impl TokenBucket {
    /// Creates a new token bucket.
    ///
    /// # Arguments
    ///
    /// * `capacity` - Maximum number of tokens (burst limit)
    /// * `refill_rate` - Tokens added per second
    pub fn new(capacity: u64, refill_rate: f64) -> Self {
        Self {
            capacity,
            refill_rate,
            tokens_millis: AtomicU64::new(capacity * 1000),
            last_refill: RwLock::new(Instant::now()),
            total_allowed: AtomicU64::new(0),
            total_denied: AtomicU64::new(0),
        }
    }

    /// Refills tokens based on elapsed time.
    fn refill(&self) {
        let mut last_refill = self.last_refill.write().unwrap();
        let elapsed = last_refill.elapsed();
        let tokens_to_add = (elapsed.as_secs_f64() * self.refill_rate * 1000.0) as u64;

        if tokens_to_add > 0 {
            let current = self.tokens_millis.load(Ordering::SeqCst);
            let new_tokens = (current + tokens_to_add).min(self.capacity * 1000);
            self.tokens_millis.store(new_tokens, Ordering::SeqCst);
            *last_refill = Instant::now();
        }
    }

    /// Checks if a token is available without consuming.
    pub fn check(&self) -> RateLimitResult {
        self.refill();
        let tokens_millis = self.tokens_millis.load(Ordering::SeqCst);
        let tokens = tokens_millis / 1000;

        if tokens > 0 {
            RateLimitResult::allowed(
                self.capacity - tokens,
                self.capacity,
                tokens,
                self.time_to_next_token(),
            )
        } else {
            RateLimitResult::denied(self.capacity, self.capacity, self.time_to_next_token())
        }
    }

    /// Consumes a token if available.
    pub fn consume(&self) -> RateLimitResult {
        self.refill();
        let tokens_millis = self.tokens_millis.load(Ordering::SeqCst);

        if tokens_millis >= 1000 {
            self.tokens_millis.fetch_sub(1000, Ordering::SeqCst);
            self.total_allowed.fetch_add(1, Ordering::SeqCst);
            let new_tokens = (tokens_millis - 1000) / 1000;
            RateLimitResult::allowed(
                self.capacity - new_tokens,
                self.capacity,
                new_tokens,
                self.time_to_next_token(),
            )
        } else {
            self.total_denied.fetch_add(1, Ordering::SeqCst);
            RateLimitResult::denied(self.capacity, self.capacity, self.time_to_next_token())
        }
    }

    /// Resets the bucket to full capacity.
    pub fn reset(&self) {
        self.tokens_millis.store(self.capacity * 1000, Ordering::SeqCst);
        let mut last_refill = self.last_refill.write().unwrap();
        *last_refill = Instant::now();
    }

    /// Returns statistics.
    pub fn stats(&self) -> RateLimitStats {
        self.refill();
        let tokens = self.tokens_millis.load(Ordering::SeqCst) / 1000;

        RateLimitStats {
            current: self.capacity - tokens,
            limit: self.capacity,
            remaining: tokens,
            reset_in_ms: self.time_to_next_token(),
            total_allowed: self.total_allowed.load(Ordering::SeqCst),
            total_denied: self.total_denied.load(Ordering::SeqCst),
        }
    }

    fn time_to_next_token(&self) -> u64 {
        if self.refill_rate > 0.0 {
            (1000.0 / self.refill_rate) as u64
        } else {
            u64::MAX
        }
    }
}

// =============================================================================
// Rate Limiter Algorithm
// =============================================================================

/// Algorithm used for rate limiting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitAlgorithm {
    /// Sliding window counter
    SlidingWindow,
    /// Token bucket
    TokenBucket,
}

// =============================================================================
// Rate Limiter
// =============================================================================

/// A multi-key rate limiter.
///
/// Manages rate limits for multiple keys (e.g., per-consumer, per-IP).
pub struct RateLimiter {
    /// Rate limit per key
    limit: u64,
    /// Window duration
    window: Duration,
    /// Algorithm to use
    algorithm: RateLimitAlgorithm,
    /// Per-key sliding window counters
    sliding_windows: RwLock<HashMap<String, Arc<SlidingWindowCounter>>>,
    /// Per-key token buckets
    token_buckets: RwLock<HashMap<String, Arc<TokenBucket>>>,
}

impl RateLimiter {
    /// Creates a new rate limiter with sliding window algorithm.
    pub fn sliding_window(limit: u64, window: Duration) -> Self {
        Self {
            limit,
            window,
            algorithm: RateLimitAlgorithm::SlidingWindow,
            sliding_windows: RwLock::new(HashMap::new()),
            token_buckets: RwLock::new(HashMap::new()),
        }
    }

    /// Creates a new rate limiter with token bucket algorithm.
    pub fn token_bucket(capacity: u64, refill_rate: f64) -> Self {
        Self {
            limit: capacity,
            window: Duration::from_secs_f64(1.0 / refill_rate),
            algorithm: RateLimitAlgorithm::TokenBucket,
            sliding_windows: RwLock::new(HashMap::new()),
            token_buckets: RwLock::new(HashMap::new()),
        }
    }

    /// Gets or creates a sliding window counter for a key.
    fn get_sliding_window(&self, key: &str) -> Arc<SlidingWindowCounter> {
        {
            let windows = self.sliding_windows.read().unwrap();
            if let Some(window) = windows.get(key) {
                return Arc::clone(window);
            }
        }

        let mut windows = self.sliding_windows.write().unwrap();
        windows
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(SlidingWindowCounter::new(self.limit, self.window)))
            .clone()
    }

    /// Gets or creates a token bucket for a key.
    fn get_token_bucket(&self, key: &str) -> Arc<TokenBucket> {
        {
            let buckets = self.token_buckets.read().unwrap();
            if let Some(bucket) = buckets.get(key) {
                return Arc::clone(bucket);
            }
        }

        let refill_rate = 1.0 / self.window.as_secs_f64();
        let mut buckets = self.token_buckets.write().unwrap();
        buckets
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(TokenBucket::new(self.limit, refill_rate)))
            .clone()
    }

    /// Checks if a request is allowed for the default key.
    pub fn check(&self) -> RateLimitResult {
        self.check_key("default")
    }

    /// Checks if a request is allowed for a specific key.
    pub fn check_key(&self, key: &str) -> RateLimitResult {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => self.get_sliding_window(key).check(),
            RateLimitAlgorithm::TokenBucket => self.get_token_bucket(key).check(),
        }
    }

    /// Consumes a token/slot for the default key.
    pub fn consume(&self) -> RateLimitResult {
        self.consume_key("default")
    }

    /// Consumes a token/slot for a specific key.
    pub fn consume_key(&self, key: &str) -> RateLimitResult {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => self.get_sliding_window(key).consume(),
            RateLimitAlgorithm::TokenBucket => self.get_token_bucket(key).consume(),
        }
    }

    /// Resets rate limiting for a specific key.
    pub fn reset(&self, key: &str) {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => {
                if let Some(window) = self.sliding_windows.read().unwrap().get(key) {
                    window.reset();
                }
            }
            RateLimitAlgorithm::TokenBucket => {
                if let Some(bucket) = self.token_buckets.read().unwrap().get(key) {
                    bucket.reset();
                }
            }
        }
    }

    /// Resets rate limiting for all keys.
    pub fn reset_all(&self) {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => {
                for window in self.sliding_windows.read().unwrap().values() {
                    window.reset();
                }
            }
            RateLimitAlgorithm::TokenBucket => {
                for bucket in self.token_buckets.read().unwrap().values() {
                    bucket.reset();
                }
            }
        }
    }

    /// Removes a specific key from tracking.
    pub fn remove(&self, key: &str) -> bool {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => {
                self.sliding_windows.write().unwrap().remove(key).is_some()
            }
            RateLimitAlgorithm::TokenBucket => {
                self.token_buckets.write().unwrap().remove(key).is_some()
            }
        }
    }

    /// Gets statistics for a specific key.
    pub fn stats(&self, key: &str) -> Option<RateLimitStats> {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => self
                .sliding_windows
                .read()
                .unwrap()
                .get(key)
                .map(|w| w.stats()),
            RateLimitAlgorithm::TokenBucket => self
                .token_buckets
                .read()
                .unwrap()
                .get(key)
                .map(|b| b.stats()),
        }
    }

    /// Lists all tracked keys.
    pub fn list_keys(&self) -> Vec<String> {
        match self.algorithm {
            RateLimitAlgorithm::SlidingWindow => {
                self.sliding_windows.read().unwrap().keys().cloned().collect()
            }
            RateLimitAlgorithm::TokenBucket => {
                self.token_buckets.read().unwrap().keys().cloned().collect()
            }
        }
    }

    /// Clears all tracked keys.
    pub fn clear(&self) {
        self.sliding_windows.write().unwrap().clear();
        self.token_buckets.write().unwrap().clear();
    }
}

// =============================================================================
// Rate Limited Queue
// =============================================================================

/// A queue wrapper that adds rate limiting.
///
/// Rate limits can be applied to:
/// - Enqueue operations (producer limit)
/// - Dequeue operations (consumer limit)
pub struct RateLimitedQueue<T: LinkType, Q: Queue<T>> {
    /// The underlying queue
    queue: Q,
    /// Rate limiter for enqueue operations
    enqueue_limiter: RateLimiter,
    /// Rate limiter for dequeue operations
    dequeue_limiter: RateLimiter,
    /// Phantom data for type parameter
    _marker: std::marker::PhantomData<T>,
}

impl<T: LinkType, Q: Queue<T>> RateLimitedQueue<T, Q> {
    /// Creates a new rate-limited queue.
    ///
    /// # Arguments
    ///
    /// * `queue` - The underlying queue
    /// * `enqueue_limit` - Maximum enqueue operations per window
    /// * `dequeue_limit` - Maximum dequeue operations per window
    /// * `window` - Window duration for rate limiting
    pub fn new(queue: Q, enqueue_limit: u64, dequeue_limit: u64, window: Duration) -> Self {
        Self {
            queue,
            enqueue_limiter: RateLimiter::sliding_window(enqueue_limit, window),
            dequeue_limiter: RateLimiter::sliding_window(dequeue_limit, window),
            _marker: std::marker::PhantomData,
        }
    }

    /// Creates a rate-limited queue with just enqueue limiting.
    pub fn with_enqueue_limit(queue: Q, limit: u64, window: Duration) -> Self {
        Self::new(queue, limit, u64::MAX, window)
    }

    /// Creates a rate-limited queue with just dequeue limiting.
    pub fn with_dequeue_limit(queue: Q, limit: u64, window: Duration) -> Self {
        Self::new(queue, u64::MAX, limit, window)
    }

    /// Returns the queue name.
    pub fn name(&self) -> &str {
        self.queue.name()
    }

    /// Enqueues an item with rate limiting.
    pub async fn enqueue(&self, link: Link<T>) -> Result<EnqueueResult<T>, RateLimitError> {
        self.enqueue_with_key(link, "default").await
    }

    /// Enqueues an item with rate limiting for a specific key.
    pub async fn enqueue_with_key(
        &self,
        link: Link<T>,
        key: &str,
    ) -> Result<EnqueueResult<T>, RateLimitError> {
        let result = self.enqueue_limiter.consume_key(key);
        if !result.allowed {
            return Err(RateLimitError::new(
                result.reset_in_ms,
                result.limit,
                result.reset_in_ms,
            ));
        }

        self.queue
            .enqueue(link)
            .await
            .map_err(|e| RateLimitError::new(0, 0, 0)) // Convert queue error
    }

    /// Dequeues an item with rate limiting.
    pub async fn dequeue(&self) -> Result<Option<Link<T>>, RateLimitError> {
        self.dequeue_with_key("default").await
    }

    /// Dequeues an item with rate limiting for a specific key (consumer).
    pub async fn dequeue_with_key(&self, key: &str) -> Result<Option<Link<T>>, RateLimitError> {
        let result = self.dequeue_limiter.consume_key(key);
        if !result.allowed {
            return Err(RateLimitError::new(
                result.reset_in_ms,
                result.limit,
                result.reset_in_ms,
            ));
        }

        self.queue
            .dequeue()
            .await
            .map_err(|e| RateLimitError::new(0, 0, 0)) // Convert queue error
    }

    /// Peeks at the next item (not rate limited).
    pub async fn peek(&self) -> QueueResult<Option<Link<T>>> {
        self.queue.peek().await
    }

    /// Acknowledges processing of an item.
    pub async fn acknowledge(&self, id: T) -> QueueResult<()> {
        self.queue.acknowledge(id).await
    }

    /// Rejects an item.
    pub async fn reject(&self, id: T, requeue: bool) -> QueueResult<()> {
        self.queue.reject(id, requeue).await
    }

    /// Returns queue statistics.
    pub fn stats(&self) -> QueueStats {
        self.queue.stats()
    }

    /// Returns the queue depth.
    pub fn depth(&self) -> usize {
        self.queue.stats().depth
    }

    /// Resets rate limiters.
    pub fn reset_rate_limits(&self) {
        self.enqueue_limiter.reset_all();
        self.dequeue_limiter.reset_all();
    }

    /// Gets the enqueue rate limiter.
    pub fn enqueue_limiter(&self) -> &RateLimiter {
        &self.enqueue_limiter
    }

    /// Gets the dequeue rate limiter.
    pub fn dequeue_limiter(&self) -> &RateLimiter {
        &self.dequeue_limiter
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod sliding_window_tests {
        use super::*;

        #[test]
        fn test_creation() {
            let counter = SlidingWindowCounter::new(100, Duration::from_secs(60));
            let stats = counter.stats();
            assert_eq!(stats.limit, 100);
            assert_eq!(stats.current, 0);
            assert_eq!(stats.remaining, 100);
        }

        #[test]
        fn test_check_allows_under_limit() {
            let counter = SlidingWindowCounter::new(10, Duration::from_secs(60));
            let result = counter.check();
            assert!(result.allowed);
            assert_eq!(result.remaining, 10);
        }

        #[test]
        fn test_increment() {
            let counter = SlidingWindowCounter::new(10, Duration::from_secs(60));
            counter.increment();
            counter.increment();
            let result = counter.check();
            assert!(result.allowed);
            assert_eq!(result.current, 2);
        }

        #[test]
        fn test_consume_under_limit() {
            let counter = SlidingWindowCounter::new(10, Duration::from_secs(60));
            for _ in 0..5 {
                let result = counter.consume();
                assert!(result.allowed);
            }
            let stats = counter.stats();
            assert_eq!(stats.current, 5);
        }

        #[test]
        fn test_consume_at_limit() {
            let counter = SlidingWindowCounter::new(3, Duration::from_secs(60));
            for _ in 0..3 {
                let result = counter.consume();
                assert!(result.allowed);
            }
            let result = counter.consume();
            assert!(!result.allowed);
        }

        #[test]
        fn test_reset() {
            let counter = SlidingWindowCounter::new(10, Duration::from_secs(60));
            for _ in 0..5 {
                counter.consume();
            }
            counter.reset();
            let stats = counter.stats();
            assert_eq!(stats.current, 0);
        }
    }

    mod token_bucket_tests {
        use super::*;

        #[test]
        fn test_creation_full() {
            let bucket = TokenBucket::new(10, 1.0);
            let stats = bucket.stats();
            assert_eq!(stats.limit, 10);
            assert_eq!(stats.remaining, 10);
        }

        #[test]
        fn test_check_allows() {
            let bucket = TokenBucket::new(10, 1.0);
            let result = bucket.check();
            assert!(result.allowed);
        }

        #[test]
        fn test_consume_single() {
            let bucket = TokenBucket::new(10, 1.0);
            let result = bucket.consume();
            assert!(result.allowed);
            let stats = bucket.stats();
            assert_eq!(stats.remaining, 9);
        }

        #[test]
        fn test_consume_burst() {
            let bucket = TokenBucket::new(5, 1.0);
            for _ in 0..5 {
                let result = bucket.consume();
                assert!(result.allowed);
            }
            let result = bucket.consume();
            assert!(!result.allowed);
        }

        #[test]
        fn test_reset() {
            let bucket = TokenBucket::new(10, 1.0);
            for _ in 0..5 {
                bucket.consume();
            }
            bucket.reset();
            let stats = bucket.stats();
            assert_eq!(stats.remaining, 10);
        }
    }

    mod rate_limiter_tests {
        use super::*;

        #[test]
        fn test_sliding_window_creation() {
            let limiter = RateLimiter::sliding_window(100, Duration::from_secs(60));
            let result = limiter.check();
            assert!(result.allowed);
        }

        #[test]
        fn test_token_bucket_creation() {
            let limiter = RateLimiter::token_bucket(10, 1.0);
            let result = limiter.check();
            assert!(result.allowed);
        }

        #[test]
        fn test_multi_key() {
            let limiter = RateLimiter::sliding_window(2, Duration::from_secs(60));

            // Key 1 - exhaust limit
            limiter.consume_key("key1");
            limiter.consume_key("key1");
            let result = limiter.consume_key("key1");
            assert!(!result.allowed);

            // Key 2 - should still have full limit
            let result = limiter.consume_key("key2");
            assert!(result.allowed);
        }

        #[test]
        fn test_reset_key() {
            let limiter = RateLimiter::sliding_window(2, Duration::from_secs(60));
            limiter.consume_key("key1");
            limiter.consume_key("key1");

            limiter.reset("key1");

            let result = limiter.consume_key("key1");
            assert!(result.allowed);
        }

        #[test]
        fn test_remove_key() {
            let limiter = RateLimiter::sliding_window(10, Duration::from_secs(60));
            limiter.consume_key("key1");

            let removed = limiter.remove("key1");
            assert!(removed);

            let removed_again = limiter.remove("key1");
            assert!(!removed_again);
        }

        #[test]
        fn test_list_keys() {
            let limiter = RateLimiter::sliding_window(10, Duration::from_secs(60));
            limiter.consume_key("key1");
            limiter.consume_key("key2");

            let keys = limiter.list_keys();
            assert_eq!(keys.len(), 2);
            assert!(keys.contains(&"key1".to_string()));
            assert!(keys.contains(&"key2".to_string()));
        }

        #[test]
        fn test_clear() {
            let limiter = RateLimiter::sliding_window(10, Duration::from_secs(60));
            limiter.consume_key("key1");
            limiter.consume_key("key2");

            limiter.clear();

            assert!(limiter.list_keys().is_empty());
        }

        #[test]
        fn test_stats() {
            let limiter = RateLimiter::sliding_window(10, Duration::from_secs(60));
            limiter.consume_key("key1");

            let stats = limiter.stats("key1");
            assert!(stats.is_some());
            assert_eq!(stats.unwrap().current, 1);

            let stats = limiter.stats("nonexistent");
            assert!(stats.is_none());
        }
    }
}
