//! Scheduler module for delayed messages, cron jobs, TTL, and message expiration.
//!
//! This module provides scheduling functionality for queue operations:
//! - **Delayed Messages**: Schedule items for future delivery
//! - **Cron Jobs**: Recurring jobs using cron expressions
//! - **TTL**: Time-to-live for automatic message expiration
//! - **Message Expiration**: Automatic cleanup of expired messages
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::features::{Scheduler, CronParser};
//! use links_queue::{Link, LinkRef};
//! use std::time::Duration;
//!
//! let mut scheduler = Scheduler::new(Duration::from_secs(1));
//!
//! // Schedule a delayed message
//! let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
//! scheduler.schedule(link, Duration::from_secs(5), None);
//!
//! // Add a cron job
//! scheduler.add_cron_job("hourly-task", "0 * * * *", |_| async {
//!     println!("Hourly task executed");
//! });
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

use crate::{Link, LinkType, Queue, QueueError, QueueResult, QueueStats, EnqueueResult};

// =============================================================================
// Cron Parser
// =============================================================================

/// Parsed cron schedule with expanded field values.
#[derive(Debug, Clone)]
pub struct CronSchedule {
    /// Allowed minute values (0-59)
    pub minutes: Vec<u8>,
    /// Allowed hour values (0-23)
    pub hours: Vec<u8>,
    /// Allowed day of month values (1-31)
    pub days_of_month: Vec<u8>,
    /// Allowed month values (1-12)
    pub months: Vec<u8>,
    /// Allowed day of week values (0-6, Sunday=0)
    pub days_of_week: Vec<u8>,
}

/// Parser for cron expressions (5-field format).
///
/// Supports standard cron syntax:
/// - `*`: Any value
/// - `1,2,3`: List of values
/// - `1-5`: Range
/// - `*/2`: Step values
/// - `2/3`: Start at value with step
pub struct CronParser;

impl CronParser {
    /// Parses a single cron field.
    ///
    /// # Arguments
    ///
    /// * `field` - The field string to parse
    /// * `min` - Minimum allowed value
    /// * `max` - Maximum allowed value
    ///
    /// # Returns
    ///
    /// A sorted vector of values within the valid range.
    pub fn parse_field(field: &str, min: u8, max: u8) -> Vec<u8> {
        let mut values = Vec::new();

        for part in field.split(',') {
            let part = part.trim();

            if part == "*" {
                // Wildcard: all values
                values.extend(min..=max);
            } else if part.contains('/') {
                // Step value
                let parts: Vec<&str> = part.split('/').collect();
                if parts.len() == 2 {
                    let step: u8 = parts[1].parse().unwrap_or(1);
                    let start = if parts[0] == "*" {
                        min
                    } else {
                        parts[0].parse().unwrap_or(min)
                    };
                    let mut i = start;
                    while i <= max {
                        values.push(i);
                        i = i.saturating_add(step);
                    }
                }
            } else if part.contains('-') {
                // Range
                let parts: Vec<&str> = part.split('-').collect();
                if parts.len() == 2 {
                    let start: u8 = parts[0].parse().unwrap_or(min);
                    let end: u8 = parts[1].parse().unwrap_or(max);
                    values.extend(start..=end);
                }
            } else if let Ok(val) = part.parse::<u8>() {
                values.push(val);
            }
        }

        // Filter and deduplicate
        values.retain(|&v| v >= min && v <= max);
        values.sort_unstable();
        values.dedup();
        values
    }

    /// Parses a complete 5-field cron expression.
    ///
    /// # Arguments
    ///
    /// * `expression` - Cron expression in format "minute hour day month weekday"
    ///
    /// # Returns
    ///
    /// Parsed `CronSchedule` or error string.
    pub fn parse(expression: &str) -> Result<CronSchedule, String> {
        let fields: Vec<&str> = expression.split_whitespace().collect();

        if fields.len() != 5 {
            return Err(format!(
                "Invalid cron expression: expected 5 fields, got {}",
                fields.len()
            ));
        }

        Ok(CronSchedule {
            minutes: Self::parse_field(fields[0], 0, 59),
            hours: Self::parse_field(fields[1], 0, 23),
            days_of_month: Self::parse_field(fields[2], 1, 31),
            months: Self::parse_field(fields[3], 1, 12),
            days_of_week: Self::parse_field(fields[4], 0, 6),
        })
    }

    /// Calculates the next run time for a cron expression.
    ///
    /// # Arguments
    ///
    /// * `expression` - Cron expression
    /// * `after` - Time to start searching from (defaults to now)
    ///
    /// # Returns
    ///
    /// Unix timestamp of next run time, or None if no valid time found.
    pub fn next_run(expression: &str, after: Option<u64>) -> Option<u64> {
        let schedule = Self::parse(expression).ok()?;
        Self::next_run_from_schedule(&schedule, after)
    }

    /// Calculates the next run time from a parsed schedule.
    pub fn next_run_from_schedule(schedule: &CronSchedule, after: Option<u64>) -> Option<u64> {
        let after_ms = after.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

        // Convert to seconds for easier calculation
        let after_secs = after_ms / 1000;

        // Start searching from the next minute
        let mut candidate = after_secs - (after_secs % 60) + 60;

        // Search for up to 4 years
        let max_iterations = 4 * 365 * 24 * 60;

        for _ in 0..max_iterations {
            let datetime = Self::timestamp_to_parts(candidate);

            // Check all fields
            if schedule.months.contains(&datetime.month)
                && schedule.days_of_month.contains(&datetime.day)
                && schedule.days_of_week.contains(&datetime.weekday)
                && schedule.hours.contains(&datetime.hour)
                && schedule.minutes.contains(&datetime.minute)
            {
                return Some(candidate * 1000);
            }

            candidate += 60; // Move to next minute
        }

        None
    }

    /// Converts a Unix timestamp to date/time parts.
    fn timestamp_to_parts(timestamp: u64) -> DateTimeParts {
        // Simple implementation - this is approximate but works for our needs
        let days_since_epoch = timestamp / 86400;
        let time_of_day = timestamp % 86400;

        let hour = (time_of_day / 3600) as u8;
        let minute = ((time_of_day % 3600) / 60) as u8;

        // Calculate weekday (Jan 1, 1970 was Thursday = 4)
        let weekday = ((days_since_epoch + 4) % 7) as u8;

        // Approximate year/month/day calculation
        let mut year = 1970i32;
        let mut remaining_days = days_since_epoch as i32;

        loop {
            let days_in_year = if Self::is_leap_year(year) { 366 } else { 365 };
            if remaining_days < days_in_year {
                break;
            }
            remaining_days -= days_in_year;
            year += 1;
        }

        let mut month = 1u8;
        let days_in_months = Self::days_in_months(Self::is_leap_year(year));
        for (i, &days) in days_in_months.iter().enumerate() {
            if remaining_days < i32::from(days) {
                month = (i + 1) as u8;
                break;
            }
            remaining_days -= i32::from(days);
        }

        let day = (remaining_days + 1) as u8;

        DateTimeParts {
            minute,
            hour,
            day,
            month,
            weekday,
        }
    }

    fn is_leap_year(year: i32) -> bool {
        (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
    }

    fn days_in_months(leap: bool) -> [u8; 12] {
        if leap {
            [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        } else {
            [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        }
    }
}

struct DateTimeParts {
    minute: u8,
    hour: u8,
    day: u8,
    month: u8,
    weekday: u8,
}

// =============================================================================
// Scheduled Item
// =============================================================================

/// A scheduled item waiting for delivery.
#[derive(Debug, Clone)]
pub struct ScheduledItem<T: LinkType> {
    /// Unique identifier for this scheduled item
    pub id: T,
    /// The link to deliver
    pub link: Link<T>,
    /// Scheduled delivery time (Unix timestamp in milliseconds)
    pub deliver_at: u64,
    /// Expiration time (Unix timestamp in milliseconds), if set
    pub expires_at: Option<u64>,
    /// When this item was scheduled
    pub scheduled_at: u64,
}

impl<T: LinkType> ScheduledItem<T> {
    /// Creates a new scheduled item.
    pub fn new(id: T, link: Link<T>, deliver_at: u64, expires_at: Option<u64>) -> Self {
        let scheduled_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        Self {
            id,
            link,
            deliver_at,
            expires_at,
            scheduled_at,
        }
    }

    /// Checks if this item has expired.
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            now >= expires_at
        } else {
            false
        }
    }

    /// Checks if this item is due for delivery.
    pub fn is_due(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        now >= self.deliver_at
    }
}

// =============================================================================
// Cron Job
// =============================================================================

/// A recurring cron job.
pub struct CronJob<F> {
    /// Unique identifier for this job
    pub id: String,
    /// The cron expression
    pub expression: String,
    /// Parsed schedule
    pub schedule: CronSchedule,
    /// Whether the job is enabled
    pub enabled: bool,
    /// Next scheduled run time
    pub next_run: Option<u64>,
    /// Handler function
    handler: F,
}

impl<F> CronJob<F> {
    /// Creates a new cron job.
    pub fn new(id: String, expression: String, handler: F) -> Result<Self, String> {
        let schedule = CronParser::parse(&expression)?;
        let next_run = CronParser::next_run_from_schedule(&schedule, None);

        Ok(Self {
            id,
            expression,
            schedule,
            enabled: true,
            next_run,
            handler,
        })
    }

    /// Updates the next run time.
    pub fn update_next_run(&mut self) {
        self.next_run = CronParser::next_run_from_schedule(&self.schedule, None);
    }

    /// Gets a reference to the handler.
    pub fn handler(&self) -> &F {
        &self.handler
    }
}

// =============================================================================
// Scheduler Statistics
// =============================================================================

/// Statistics for the scheduler.
#[derive(Debug, Clone, Default)]
pub struct SchedulerStats {
    /// Number of items currently scheduled
    pub scheduled: usize,
    /// Number of items pending delivery
    pub pending: usize,
    /// Number of cron jobs
    pub cron_jobs: usize,
    /// Total number of items delivered
    pub delivered: u64,
    /// Total number of items expired
    pub expired: u64,
}

// =============================================================================
// Scheduler
// =============================================================================

/// Configuration for the scheduler.
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// How often to check for due items (default: 1 second)
    pub check_interval: Duration,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            check_interval: Duration::from_secs(1),
        }
    }
}

/// The main scheduler for managing delayed messages and cron jobs.
///
/// Type parameter `T` is the link ID type.
/// Type parameter `F` is the cron job handler type.
pub struct Scheduler<T: LinkType, F = fn(Link<T>)> {
    /// Scheduled items
    items: Arc<RwLock<HashMap<T, ScheduledItem<T>>>>,
    /// Cron jobs
    cron_jobs: Arc<RwLock<HashMap<String, CronJob<F>>>>,
    /// Scheduler configuration
    config: SchedulerConfig,
    /// Whether the scheduler is running
    running: Arc<AtomicBool>,
    /// Counter for delivered items
    delivered_count: Arc<AtomicU64>,
    /// Counter for expired items
    expired_count: Arc<AtomicU64>,
    /// ID counter for auto-generated IDs
    id_counter: Arc<AtomicU64>,
}

impl<T: LinkType + From<u64>, F> Scheduler<T, F> {
    /// Creates a new scheduler with default configuration.
    pub fn new() -> Self {
        Self::with_config(SchedulerConfig::default())
    }

    /// Creates a new scheduler with custom configuration.
    pub fn with_config(config: SchedulerConfig) -> Self {
        Self {
            items: Arc::new(RwLock::new(HashMap::new())),
            cron_jobs: Arc::new(RwLock::new(HashMap::new())),
            config,
            running: Arc::new(AtomicBool::new(false)),
            delivered_count: Arc::new(AtomicU64::new(0)),
            expired_count: Arc::new(AtomicU64::new(0)),
            id_counter: Arc::new(AtomicU64::new(1)),
        }
    }

    /// Schedules an item for delayed delivery.
    ///
    /// # Arguments
    ///
    /// * `link` - The link to deliver
    /// * `delay` - Delay duration before delivery
    /// * `ttl` - Optional time-to-live (item expires if not delivered before this)
    ///
    /// # Returns
    ///
    /// The scheduled item.
    pub fn schedule(&self, link: Link<T>, delay: Duration, ttl: Option<Duration>) -> ScheduledItem<T> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let deliver_at = now + delay.as_millis() as u64;
        let expires_at = ttl.map(|d| now + d.as_millis() as u64);

        let id = T::from(self.id_counter.fetch_add(1, Ordering::SeqCst));
        let item = ScheduledItem::new(id.clone(), link, deliver_at, expires_at);

        let mut items = self.items.write().unwrap();
        items.insert(id.clone(), item.clone());

        item
    }

    /// Schedules an item with a specific delivery time.
    pub fn schedule_at(&self, link: Link<T>, deliver_at: u64, ttl: Option<Duration>) -> ScheduledItem<T> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let expires_at = ttl.map(|d| now + d.as_millis() as u64);

        let id = T::from(self.id_counter.fetch_add(1, Ordering::SeqCst));
        let item = ScheduledItem::new(id.clone(), link, deliver_at, expires_at);

        let mut items = self.items.write().unwrap();
        items.insert(id.clone(), item.clone());

        item
    }

    /// Cancels a scheduled item.
    ///
    /// # Returns
    ///
    /// `true` if the item was found and cancelled.
    pub fn cancel(&self, id: &T) -> bool {
        let mut items = self.items.write().unwrap();
        items.remove(id).is_some()
    }

    /// Gets a scheduled item by ID.
    pub fn get(&self, id: &T) -> Option<ScheduledItem<T>> {
        let items = self.items.read().unwrap();
        items.get(id).cloned()
    }

    /// Returns all pending items.
    pub fn get_pending_items(&self) -> Vec<ScheduledItem<T>> {
        let items = self.items.read().unwrap();
        items.values().cloned().collect()
    }

    /// Returns the number of pending items.
    pub fn pending_count(&self) -> usize {
        let items = self.items.read().unwrap();
        items.len()
    }

    /// Checks if the scheduler is running.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Returns scheduler statistics.
    pub fn stats(&self) -> SchedulerStats {
        let items = self.items.read().unwrap();
        let cron_jobs = self.cron_jobs.read().unwrap();

        SchedulerStats {
            scheduled: items.len(),
            pending: items.len(),
            cron_jobs: cron_jobs.len(),
            delivered: self.delivered_count.load(Ordering::SeqCst),
            expired: self.expired_count.load(Ordering::SeqCst),
        }
    }

    /// Clears all scheduled items and cron jobs.
    pub fn clear(&self) {
        self.stop();
        let mut items = self.items.write().unwrap();
        items.clear();
        let mut cron_jobs = self.cron_jobs.write().unwrap();
        cron_jobs.clear();
    }

    /// Starts the scheduler background task.
    pub fn start(&self) {
        self.running.store(true, Ordering::SeqCst);
    }

    /// Stops the scheduler background task.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// Process due items and return them.
    ///
    /// This should be called periodically (or in response to a timer).
    pub fn process_due(&self) -> (Vec<Link<T>>, Vec<ScheduledItem<T>>) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut due_items = Vec::new();
        let mut expired_items = Vec::new();

        let mut items = self.items.write().unwrap();
        let mut to_remove = Vec::new();

        for (id, item) in items.iter() {
            if item.expires_at.map_or(false, |exp| now >= exp) {
                // Item expired
                expired_items.push(item.clone());
                to_remove.push(id.clone());
            } else if now >= item.deliver_at {
                // Item is due
                due_items.push(item.link.clone());
                to_remove.push(id.clone());
            }
        }

        // Remove processed items
        for id in to_remove {
            items.remove(&id);
        }

        // Update counters
        self.delivered_count.fetch_add(due_items.len() as u64, Ordering::SeqCst);
        self.expired_count.fetch_add(expired_items.len() as u64, Ordering::SeqCst);

        (due_items, expired_items)
    }
}

impl<T: LinkType + From<u64>, F> Scheduler<T, F> {
    /// Adds a cron job.
    ///
    /// # Arguments
    ///
    /// * `id` - Unique identifier for the job
    /// * `expression` - Cron expression
    /// * `handler` - Handler function to call when the job runs
    ///
    /// # Returns
    ///
    /// The created `CronJob` or an error if the expression is invalid.
    pub fn add_cron_job(&self, id: &str, expression: &str, handler: F) -> Result<(), String> {
        let job = CronJob::new(id.to_string(), expression.to_string(), handler)?;
        let mut cron_jobs = self.cron_jobs.write().unwrap();
        cron_jobs.insert(id.to_string(), job);
        Ok(())
    }

    /// Removes a cron job.
    pub fn remove_cron_job(&self, id: &str) -> bool {
        let mut cron_jobs = self.cron_jobs.write().unwrap();
        cron_jobs.remove(id).is_some()
    }

    /// Gets a cron job by ID.
    pub fn get_cron_job(&self, id: &str) -> Option<(String, bool, Option<u64>)> {
        let cron_jobs = self.cron_jobs.read().unwrap();
        cron_jobs.get(id).map(|job| {
            (job.expression.clone(), job.enabled, job.next_run)
        })
    }

    /// Enables or disables a cron job.
    pub fn set_cron_job_enabled(&self, id: &str, enabled: bool) -> bool {
        let mut cron_jobs = self.cron_jobs.write().unwrap();
        if let Some(job) = cron_jobs.get_mut(id) {
            job.enabled = enabled;
            if enabled {
                job.update_next_run();
            }
            true
        } else {
            false
        }
    }

    /// Lists all cron jobs.
    pub fn list_cron_jobs(&self) -> Vec<(String, String, bool, Option<u64>)> {
        let cron_jobs = self.cron_jobs.read().unwrap();
        cron_jobs
            .values()
            .map(|job| (job.id.clone(), job.expression.clone(), job.enabled, job.next_run))
            .collect()
    }
}

impl<T: LinkType + From<u64>, F> Default for Scheduler<T, F> {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Scheduled Queue
// =============================================================================

/// A queue wrapper that adds scheduling capabilities.
///
/// This wraps an existing queue implementation to add support for:
/// - Delayed message delivery
/// - TTL-based expiration
/// - Scheduled enqueue operations
pub struct ScheduledQueue<T: LinkType + From<u64>, Q: Queue<T>> {
    /// The underlying queue
    queue: Q,
    /// The scheduler for delayed items
    scheduler: Scheduler<T>,
}

impl<T: LinkType + From<u64>, Q: Queue<T>> ScheduledQueue<T, Q> {
    /// Creates a new scheduled queue wrapping the given queue.
    pub fn new(queue: Q) -> Self {
        Self {
            queue,
            scheduler: Scheduler::new(),
        }
    }

    /// Returns the queue name.
    pub fn name(&self) -> &str {
        self.queue.name()
    }

    /// Enqueues an item with optional delay and TTL.
    ///
    /// If delay is provided, the item is scheduled for later delivery.
    /// If no delay, the item is enqueued immediately.
    pub async fn enqueue(
        &self,
        link: Link<T>,
        delay: Option<Duration>,
        ttl: Option<Duration>,
    ) -> QueueResult<EnqueueResult<T>> {
        match delay {
            Some(d) if d > Duration::ZERO => {
                // Schedule for later
                let item = self.scheduler.schedule(link, d, ttl);
                Ok(EnqueueResult::new(item.id, 0))
            }
            _ => {
                // Enqueue immediately
                self.queue.enqueue(link).await
            }
        }
    }

    /// Dequeues the next available item.
    pub async fn dequeue(&self) -> QueueResult<Option<Link<T>>> {
        // First, process any due items from the scheduler
        let (due_items, _) = self.scheduler.process_due();
        for link in due_items {
            self.queue.enqueue(link).await?;
        }

        self.queue.dequeue().await
    }

    /// Peeks at the next item without removing it.
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

    /// Cancels a scheduled item.
    pub fn cancel_scheduled(&self, id: &T) -> bool {
        self.scheduler.cancel(id)
    }

    /// Returns queue statistics including scheduled items.
    pub fn stats(&self) -> QueueStats {
        self.queue.stats()
    }

    /// Returns the queue depth including scheduled items.
    pub fn depth(&self) -> usize {
        self.queue.stats().depth + self.scheduler.pending_count()
    }

    /// Returns the scheduler.
    pub fn scheduler(&self) -> &Scheduler<T> {
        &self.scheduler
    }

    /// Starts the scheduler.
    pub fn start(&self) {
        self.scheduler.start();
    }

    /// Stops the scheduler.
    pub fn stop(&self) {
        self.scheduler.stop();
    }

    /// Clears the queue and scheduler.
    pub async fn clear(&self) {
        self.scheduler.clear();
        // Note: The base queue doesn't have a clear method in the trait,
        // so we just clear the scheduler state
    }
}

