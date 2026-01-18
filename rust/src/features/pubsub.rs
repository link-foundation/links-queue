//! Pub/Sub module for links-queue.
//!
//! This module provides publish/subscribe messaging patterns:
//! - Topic creation/deletion
//! - Subscribe/unsubscribe
//! - Fan-out delivery
//! - Message filtering
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::features::pubsub::{PubSubBroker, MessageFilter};
//!
//! let broker = PubSubBroker::new(Default::default());
//!
//! // Create a topic
//! broker.create_topic("events").await?;
//!
//! // Subscribe to the topic
//! let sub_id = broker.subscribe("events", |msg| async move {
//!     println!("Received: {:?}", msg.data);
//!     Ok(())
//! }, None).await?;
//!
//! // Publish a message
//! broker.publish("events", "Hello, World!", None).await?;
//!
//! // Unsubscribe
//! broker.unsubscribe(&sub_id).await?;
//! ```

use std::collections::{HashMap, HashSet};
use std::fmt::Debug;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::queue::traits::{Queue, QueueManager};

// =============================================================================
// Types and Errors
// =============================================================================

/// Error type for pub/sub operations.
#[derive(Debug, Clone)]
pub enum PubSubError {
    /// Topic already exists.
    TopicExists(String),
    /// Topic not found.
    TopicNotFound(String),
    /// Subscription not found.
    SubscriptionNotFound(String),
    /// Queue error.
    QueueError(String),
}

impl std::fmt::Display for PubSubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PubSubError::TopicExists(name) => write!(f, "Topic '{}' already exists", name),
            PubSubError::TopicNotFound(name) => write!(f, "Topic '{}' not found", name),
            PubSubError::SubscriptionNotFound(id) => write!(f, "Subscription '{}' not found", id),
            PubSubError::QueueError(msg) => write!(f, "Queue error: {}", msg),
        }
    }
}

impl std::error::Error for PubSubError {}

/// Result type for pub/sub operations.
pub type PubSubResult<T> = Result<T, PubSubError>;

/// A published message.
#[derive(Debug, Clone)]
pub struct PublishedMessage<T> {
    /// Unique message identifier.
    pub id: String,
    /// Topic the message was published to.
    pub topic: String,
    /// The message data.
    pub data: T,
    /// Publication timestamp.
    pub timestamp: Instant,
    /// Optional message headers.
    pub headers: HashMap<String, String>,
}

/// Topic information.
#[derive(Debug, Clone)]
pub struct Topic {
    /// Topic name.
    pub name: String,
    /// Creation timestamp.
    pub created: Instant,
    /// Total messages published.
    pub message_count: u64,
    /// Current number of subscribers.
    pub subscriber_count: usize,
}

/// Subscription information.
#[derive(Debug, Clone)]
pub struct SubscriptionInfo {
    /// Unique subscription identifier.
    pub id: String,
    /// Topic name.
    pub topic: String,
    /// Whether the subscription is active.
    pub active: bool,
    /// Creation timestamp.
    pub created: Instant,
    /// Number of messages received.
    pub received: u64,
}

/// Pub/sub broker statistics.
#[derive(Debug, Clone, Default)]
pub struct PubSubStats {
    /// Number of topics.
    pub topics: usize,
    /// Number of subscriptions.
    pub subscriptions: usize,
    /// Total messages published.
    pub published: u64,
    /// Total messages delivered.
    pub delivered: u64,
    /// Total messages filtered out.
    pub filtered: u64,
}

/// Delivery result from publishing a message.
#[derive(Debug, Clone, Default)]
pub struct DeliveryResult {
    /// Number of subscribers that received the message.
    pub delivered: usize,
    /// Number of subscribers that filtered out the message.
    pub filtered: usize,
}

/// Broker configuration options.
#[derive(Debug, Clone)]
pub struct BrokerOptions {
    /// Automatically create topics on publish.
    pub auto_create_topics: bool,
    /// Message retention duration (None = no retention).
    pub message_retention: Option<Duration>,
}

impl Default for BrokerOptions {
    fn default() -> Self {
        Self {
            auto_create_topics: true,
            message_retention: None,
        }
    }
}

// =============================================================================
// Message Filter
// =============================================================================

/// Filter for messages based on content.
///
/// Provides utilities for filtering messages based on various criteria.
///
/// # Example
///
/// ```rust,ignore
/// use links_queue::features::pubsub::MessageFilter;
///
/// let filter = MessageFilter::new()
///     .with_header("priority", "high")
///     .with_custom(|msg| msg.data.len() > 10);
///
/// let matches = filter.matches(&message);
/// ```
#[derive(Clone)]
pub struct MessageFilter<T> {
    /// Header filters (key -> expected value).
    header_filters: HashMap<String, String>,
    /// Custom filter functions.
    custom_filters: Vec<Arc<dyn Fn(&PublishedMessage<T>) -> bool + Send + Sync>>,
}

impl<T> Default for MessageFilter<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> MessageFilter<T> {
    /// Creates a new empty filter.
    pub fn new() -> Self {
        Self {
            header_filters: HashMap::new(),
            custom_filters: Vec::new(),
        }
    }

    /// Adds a header filter.
    pub fn with_header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.header_filters.insert(key.into(), value.into());
        self
    }

    /// Adds a custom filter function.
    pub fn with_custom<F>(mut self, filter: F) -> Self
    where
        F: Fn(&PublishedMessage<T>) -> bool + Send + Sync + 'static,
    {
        self.custom_filters.push(Arc::new(filter));
        self
    }

    /// Checks if a message matches all filters.
    pub fn matches(&self, message: &PublishedMessage<T>) -> bool {
        // Check header filters
        for (key, expected) in &self.header_filters {
            match message.headers.get(key) {
                Some(value) if value == expected => continue,
                _ => return false,
            }
        }

        // Check custom filters
        for filter in &self.custom_filters {
            if !filter(message) {
                return false;
            }
        }

        true
    }

    /// Returns true if the filter has no conditions.
    pub fn is_empty(&self) -> bool {
        self.header_filters.is_empty() && self.custom_filters.is_empty()
    }
}

impl<T> Debug for MessageFilter<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MessageFilter")
            .field("header_filters", &self.header_filters)
            .field("custom_filters_count", &self.custom_filters.len())
            .finish()
    }
}

// =============================================================================
// Subscription (internal)
// =============================================================================

type AsyncHandler<T> =
    Arc<dyn Fn(PublishedMessage<T>) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

struct Subscription<T> {
    id: String,
    topic: String,
    handler: AsyncHandler<T>,
    filter: Option<MessageFilter<T>>,
    active: bool,
    created: Instant,
    received: AtomicU64,
}

// =============================================================================
// Pub/Sub Broker
// =============================================================================

/// Central broker for pub/sub messaging.
///
/// Manages topics, subscriptions, and message delivery.
///
/// # Example
///
/// ```rust,ignore
/// use links_queue::features::pubsub::{PubSubBroker, BrokerOptions};
///
/// let broker = PubSubBroker::<String>::new(BrokerOptions::default());
///
/// // Create a topic
/// broker.create_topic("events").await?;
///
/// // Subscribe
/// let sub_id = broker.subscribe("events", |msg| async move {
///     println!("Received: {}", msg.data);
/// }, None).await?;
///
/// // Publish
/// broker.publish("events", "Hello!".to_string(), None).await?;
/// ```
pub struct PubSubBroker<T: Clone + Send + Sync + 'static> {
    /// Configuration options.
    options: BrokerOptions,
    /// Topics by name.
    topics: RwLock<HashMap<String, Topic>>,
    /// Subscriptions by ID.
    subscriptions: RwLock<HashMap<String, Subscription<T>>>,
    /// Subscription IDs grouped by topic.
    topic_subscriptions: RwLock<HashMap<String, HashSet<String>>>,
    /// Message history (if retention enabled).
    message_history: RwLock<HashMap<String, Vec<PublishedMessage<T>>>>,
    /// ID counter.
    id_counter: AtomicU64,
    /// Statistics.
    stats: RwLock<PubSubStats>,
}

impl<T: Clone + Send + Sync + 'static> PubSubBroker<T> {
    /// Creates a new PubSubBroker.
    pub fn new(options: BrokerOptions) -> Self {
        Self {
            options,
            topics: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(HashMap::new()),
            topic_subscriptions: RwLock::new(HashMap::new()),
            message_history: RwLock::new(HashMap::new()),
            id_counter: AtomicU64::new(0),
            stats: RwLock::new(PubSubStats::default()),
        }
    }

    /// Generates a unique ID.
    fn generate_id(&self, prefix: &str) -> String {
        let counter = self.id_counter.fetch_add(1, Ordering::SeqCst);
        format!("{}_{}", prefix, counter)
    }

    /// Creates a new topic.
    pub async fn create_topic(&self, name: impl Into<String>) -> PubSubResult<Topic> {
        let name = name.into();

        let mut topics = self.topics.write().await;
        if topics.contains_key(&name) {
            return Err(PubSubError::TopicExists(name));
        }

        let topic = Topic {
            name: name.clone(),
            created: Instant::now(),
            message_count: 0,
            subscriber_count: 0,
        };

        topics.insert(name.clone(), topic.clone());
        self.topic_subscriptions
            .write()
            .await
            .insert(name.clone(), HashSet::new());

        if self.options.message_retention.is_some() {
            self.message_history
                .write()
                .await
                .insert(name, Vec::new());
        }

        let mut stats = self.stats.write().await;
        stats.topics += 1;

        Ok(topic)
    }

    /// Gets a topic by name.
    pub async fn get_topic(&self, name: &str) -> Option<Topic> {
        self.topics.read().await.get(name).cloned()
    }

    /// Deletes a topic and all its subscriptions.
    pub async fn delete_topic(&self, name: &str) -> PubSubResult<bool> {
        let mut topics = self.topics.write().await;
        if !topics.contains_key(name) {
            return Ok(false);
        }

        // Remove all subscriptions for this topic
        let sub_ids: Vec<String> = {
            let topic_subs = self.topic_subscriptions.read().await;
            topic_subs
                .get(name)
                .map(|s| s.iter().cloned().collect())
                .unwrap_or_default()
        };

        let mut subscriptions = self.subscriptions.write().await;
        for sub_id in sub_ids {
            subscriptions.remove(&sub_id);
        }

        self.topic_subscriptions.write().await.remove(name);
        self.message_history.write().await.remove(name);
        topics.remove(name);

        let mut stats = self.stats.write().await;
        stats.topics = stats.topics.saturating_sub(1);

        Ok(true)
    }

    /// Lists all topics.
    pub async fn list_topics(&self) -> Vec<Topic> {
        self.topics.read().await.values().cloned().collect()
    }

    /// Subscribes to a topic.
    pub async fn subscribe<F, Fut>(
        &self,
        topic: impl Into<String>,
        handler: F,
        filter: Option<MessageFilter<T>>,
    ) -> PubSubResult<String>
    where
        F: Fn(PublishedMessage<T>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let topic = topic.into();

        // Auto-create topic if enabled
        if !self.topics.read().await.contains_key(&topic) {
            if self.options.auto_create_topics {
                self.create_topic(&topic).await?;
            } else {
                return Err(PubSubError::TopicNotFound(topic));
            }
        }

        let sub_id = self.generate_id("sub");

        let subscription = Subscription {
            id: sub_id.clone(),
            topic: topic.clone(),
            handler: Arc::new(move |msg| Box::pin(handler(msg))),
            filter,
            active: true,
            created: Instant::now(),
            received: AtomicU64::new(0),
        };

        self.subscriptions
            .write()
            .await
            .insert(sub_id.clone(), subscription);

        self.topic_subscriptions
            .write()
            .await
            .get_mut(&topic)
            .map(|s| s.insert(sub_id.clone()));

        // Update topic subscriber count
        if let Some(topic_info) = self.topics.write().await.get_mut(&topic) {
            topic_info.subscriber_count += 1;
        }

        let mut stats = self.stats.write().await;
        stats.subscriptions += 1;

        Ok(sub_id)
    }

    /// Unsubscribes from a topic.
    pub async fn unsubscribe(&self, subscription_id: &str) -> PubSubResult<bool> {
        let subscription = {
            let subscriptions = self.subscriptions.read().await;
            subscriptions.get(subscription_id).map(|s| s.topic.clone())
        };

        let topic = match subscription {
            Some(t) => t,
            None => return Ok(false),
        };

        // Remove from topic's subscription set
        self.topic_subscriptions
            .write()
            .await
            .get_mut(&topic)
            .map(|s| s.remove(subscription_id));

        // Update topic subscriber count
        if let Some(topic_info) = self.topics.write().await.get_mut(&topic) {
            topic_info.subscriber_count = topic_info.subscriber_count.saturating_sub(1);
        }

        self.subscriptions.write().await.remove(subscription_id);

        let mut stats = self.stats.write().await;
        stats.subscriptions = stats.subscriptions.saturating_sub(1);

        Ok(true)
    }

    /// Pauses a subscription.
    pub async fn pause(&self, subscription_id: &str) -> bool {
        if let Some(sub) = self.subscriptions.write().await.get_mut(subscription_id) {
            sub.active = false;
            true
        } else {
            false
        }
    }

    /// Resumes a subscription.
    pub async fn resume(&self, subscription_id: &str) -> bool {
        if let Some(sub) = self.subscriptions.write().await.get_mut(subscription_id) {
            sub.active = true;
            true
        } else {
            false
        }
    }

    /// Gets subscription information.
    pub async fn get_subscription(&self, subscription_id: &str) -> Option<SubscriptionInfo> {
        self.subscriptions
            .read()
            .await
            .get(subscription_id)
            .map(|s| SubscriptionInfo {
                id: s.id.clone(),
                topic: s.topic.clone(),
                active: s.active,
                created: s.created,
                received: s.received.load(Ordering::SeqCst),
            })
    }

    /// Lists all subscriptions, optionally filtered by topic.
    pub async fn list_subscriptions(&self, topic: Option<&str>) -> Vec<SubscriptionInfo> {
        let subscriptions = self.subscriptions.read().await;
        subscriptions
            .values()
            .filter(|s| topic.map_or(true, |t| s.topic == t))
            .map(|s| SubscriptionInfo {
                id: s.id.clone(),
                topic: s.topic.clone(),
                active: s.active,
                created: s.created,
                received: s.received.load(Ordering::SeqCst),
            })
            .collect()
    }

    /// Publishes a message to a topic.
    pub async fn publish(
        &self,
        topic: impl Into<String>,
        data: T,
        headers: Option<HashMap<String, String>>,
    ) -> PubSubResult<DeliveryResult> {
        let topic = topic.into();

        // Auto-create topic if enabled
        if !self.topics.read().await.contains_key(&topic) {
            if self.options.auto_create_topics {
                self.create_topic(&topic).await?;
            } else {
                return Err(PubSubError::TopicNotFound(topic));
            }
        }

        let message = PublishedMessage {
            id: self.generate_id("msg"),
            topic: topic.clone(),
            data,
            timestamp: Instant::now(),
            headers: headers.unwrap_or_default(),
        };

        // Update topic stats
        if let Some(topic_info) = self.topics.write().await.get_mut(&topic) {
            topic_info.message_count += 1;
        }

        {
            let mut stats = self.stats.write().await;
            stats.published += 1;
        }

        // Store in history if retention enabled
        if let Some(retention) = self.options.message_retention {
            let mut history = self.message_history.write().await;
            if let Some(topic_history) = history.get_mut(&topic) {
                topic_history.push(message.clone());
                // Clean up old messages
                let cutoff = Instant::now() - retention;
                topic_history.retain(|m| m.timestamp >= cutoff);
            }
        }

        // Deliver to subscribers
        let mut delivered = 0usize;
        let mut filtered = 0usize;

        let sub_ids: Vec<String> = {
            let topic_subs = self.topic_subscriptions.read().await;
            topic_subs
                .get(&topic)
                .map(|s| s.iter().cloned().collect())
                .unwrap_or_default()
        };

        let subscriptions = self.subscriptions.read().await;
        for sub_id in sub_ids {
            if let Some(subscription) = subscriptions.get(&sub_id) {
                if !subscription.active {
                    continue;
                }

                // Check filter
                if let Some(ref filter) = subscription.filter {
                    if !filter.matches(&message) {
                        filtered += 1;
                        continue;
                    }
                }

                // Deliver message
                let handler = subscription.handler.clone();
                let msg = message.clone();
                handler(msg).await;
                subscription.received.fetch_add(1, Ordering::SeqCst);
                delivered += 1;
            }
        }

        {
            let mut stats = self.stats.write().await;
            stats.delivered += delivered as u64;
            stats.filtered += filtered as u64;
        }

        Ok(DeliveryResult { delivered, filtered })
    }

    /// Publishes to multiple topics.
    pub async fn publish_many(
        &self,
        topics: &[&str],
        data: T,
        headers: Option<HashMap<String, String>>,
    ) -> HashMap<String, PubSubResult<DeliveryResult>> {
        let mut results = HashMap::new();

        for topic in topics {
            let result = self
                .publish(*topic, data.clone(), headers.clone())
                .await;
            results.insert(topic.to_string(), result);
        }

        results
    }

    /// Gets recent messages for a topic (if retention enabled).
    pub async fn get_history(&self, topic: &str, limit: usize) -> Vec<PublishedMessage<T>> {
        let history = self.message_history.read().await;
        history
            .get(topic)
            .map(|h| {
                let start = h.len().saturating_sub(limit);
                h[start..].to_vec()
            })
            .unwrap_or_default()
    }

    /// Gets broker statistics.
    pub async fn get_stats(&self) -> PubSubStats {
        self.stats.read().await.clone()
    }

    /// Clears all state.
    pub async fn clear(&self) {
        self.topics.write().await.clear();
        self.subscriptions.write().await.clear();
        self.topic_subscriptions.write().await.clear();
        self.message_history.write().await.clear();
        *self.stats.write().await = PubSubStats::default();
    }
}

// =============================================================================
// Observable Queue
// =============================================================================

/// Event type for queue observations.
#[derive(Debug, Clone)]
pub enum QueueEvent<T> {
    /// Item was enqueued.
    Enqueue(T),
    /// Item was dequeued.
    Dequeue(T),
    /// Item was acknowledged.
    Acknowledge(u64),
    /// Item was rejected.
    Reject(u64, bool),
}

type QueueEventHandler<T> =
    Arc<dyn Fn(QueueEvent<T>) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// A queue that supports pub/sub-style subscriptions.
///
/// Wraps an existing queue and emits events when items are enqueued/dequeued.
pub struct ObservableQueue<T: Clone + Send + Sync + 'static, Q: Queue<T>> {
    /// The underlying queue.
    queue: Q,
    /// Event handlers.
    handlers: RwLock<Vec<QueueEventHandler<T>>>,
    /// Phantom data.
    _marker: std::marker::PhantomData<T>,
}

impl<T: Clone + Send + Sync + 'static, Q: Queue<T>> ObservableQueue<T, Q> {
    /// Creates a new ObservableQueue.
    pub fn new(queue: Q) -> Self {
        Self {
            queue,
            handlers: RwLock::new(Vec::new()),
            _marker: std::marker::PhantomData,
        }
    }

    /// Subscribes to queue events.
    pub async fn subscribe<F, Fut>(&self, handler: F) -> usize
    where
        F: Fn(QueueEvent<T>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let mut handlers = self.handlers.write().await;
        let index = handlers.len();
        handlers.push(Arc::new(move |event| Box::pin(handler(event))));
        index
    }

    /// Unsubscribes from queue events.
    pub async fn unsubscribe(&self, index: usize) {
        let mut handlers = self.handlers.write().await;
        if index < handlers.len() {
            handlers.remove(index);
        }
    }

    /// Emits an event to all handlers.
    async fn emit(&self, event: QueueEvent<T>) {
        let handlers = self.handlers.read().await;
        for handler in handlers.iter() {
            handler(event.clone()).await;
        }
    }

    /// Enqueues an item and notifies subscribers.
    pub async fn enqueue(&self, item: T) -> Result<u64, Q::Error> {
        let result = self.queue.enqueue(item.clone()).await?;
        self.emit(QueueEvent::Enqueue(item)).await;
        Ok(result)
    }

    /// Dequeues an item and notifies subscribers.
    pub async fn dequeue(&self) -> Result<Option<T>, Q::Error> {
        let result = self.queue.dequeue().await?;
        if let Some(ref item) = result {
            self.emit(QueueEvent::Dequeue(item.clone())).await;
        }
        Ok(result)
    }

    /// Peeks at the next item.
    pub async fn peek(&self) -> Result<Option<T>, Q::Error> {
        self.queue.peek().await
    }

    /// Acknowledges an item and notifies subscribers.
    pub async fn acknowledge(&self, id: u64) -> Result<bool, Q::Error> {
        let result = self.queue.acknowledge(id).await?;
        if result {
            self.emit(QueueEvent::Acknowledge(id)).await;
        }
        Ok(result)
    }

    /// Rejects an item and notifies subscribers.
    pub async fn reject(&self, id: u64, requeue: bool) -> Result<bool, Q::Error> {
        let result = self.queue.reject(id, requeue).await?;
        if result {
            self.emit(QueueEvent::Reject(id, requeue)).await;
        }
        Ok(result)
    }

    /// Gets queue statistics.
    pub async fn get_stats(&self) -> Result<crate::queue::traits::QueueStats, Q::Error> {
        self.queue.get_stats().await
    }

    /// Gets the queue depth.
    pub async fn get_depth(&self) -> Result<usize, Q::Error> {
        self.queue.get_depth().await
    }

    /// Clears the queue and all handlers.
    pub async fn clear(&self) -> Result<(), Q::Error> {
        self.handlers.write().await.clear();
        self.queue.clear().await
    }
}

// =============================================================================
// Queue-backed Pub/Sub
// =============================================================================

/// Subscription info for queue-backed pub/sub.
#[derive(Debug, Clone)]
pub struct QueueSubscription {
    /// Subscription ID.
    pub id: String,
    /// Topic name.
    pub topic: String,
    /// Queue name.
    pub queue_name: String,
    /// Whether the consumer is active.
    pub active: bool,
}

/// Pub/Sub implementation backed by queues for durability.
///
/// Each subscription gets its own queue for message persistence.
pub struct QueueBackedPubSub<T, Q, M>
where
    T: Clone + Send + Sync + 'static,
    Q: Queue<T>,
    M: QueueManager<T, Q>,
{
    /// Queue manager.
    queue_manager: Arc<M>,
    /// Topics with their subscriber queue names.
    topics: RwLock<HashMap<String, HashSet<String>>>,
    /// Subscriptions by ID.
    subscriptions: RwLock<HashMap<String, QueueSubscription>>,
    /// Active consumer handles.
    active_consumers: RwLock<HashSet<String>>,
    /// ID counter.
    id_counter: AtomicU64,
    /// Phantom data.
    _marker: std::marker::PhantomData<(T, Q)>,
}

impl<T, Q, M> QueueBackedPubSub<T, Q, M>
where
    T: Clone + Send + Sync + 'static,
    Q: Queue<T>,
    M: QueueManager<T, Q>,
{
    /// Creates a new QueueBackedPubSub.
    pub fn new(queue_manager: Arc<M>) -> Self {
        Self {
            queue_manager,
            topics: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(HashMap::new()),
            active_consumers: RwLock::new(HashSet::new()),
            id_counter: AtomicU64::new(0),
            _marker: std::marker::PhantomData,
        }
    }

    /// Creates a topic.
    pub async fn create_topic(&self, name: impl Into<String>) -> bool {
        let name = name.into();
        let mut topics = self.topics.write().await;
        if topics.contains_key(&name) {
            false
        } else {
            topics.insert(name, HashSet::new());
            true
        }
    }

    /// Deletes a topic.
    pub async fn delete_topic(&self, name: &str) -> PubSubResult<bool> {
        let subscribers = {
            let topics = self.topics.read().await;
            topics.get(name).cloned()
        };

        let subscribers = match subscribers {
            Some(s) => s,
            None => return Ok(false),
        };

        // Find and remove all subscriptions for this topic
        let sub_ids: Vec<String> = {
            let subscriptions = self.subscriptions.read().await;
            subscriptions
                .iter()
                .filter(|(_, s)| subscribers.contains(&s.queue_name))
                .map(|(id, _)| id.clone())
                .collect()
        };

        for sub_id in sub_ids {
            self.unsubscribe(&sub_id).await?;
        }

        self.topics.write().await.remove(name);
        Ok(true)
    }

    /// Subscribes to a topic with a dedicated queue.
    pub async fn subscribe(&self, topic: impl Into<String>, subscriber_id: &str) -> PubSubResult<QueueSubscription> {
        let topic = topic.into();

        // Create topic if not exists
        {
            let mut topics = self.topics.write().await;
            if !topics.contains_key(&topic) {
                topics.insert(topic.clone(), HashSet::new());
            }
        }

        // Create a dedicated queue for this subscriber
        let queue_name = format!("{}-{}", topic, subscriber_id);
        self.queue_manager
            .create_queue(&queue_name)
            .await
            .map_err(|e| PubSubError::QueueError(format!("{:?}", e)))?;

        // Register the queue with the topic
        self.topics
            .write()
            .await
            .get_mut(&topic)
            .map(|s| s.insert(queue_name.clone()));

        // Create subscription record
        let sub_id = format!("sub_{}", self.id_counter.fetch_add(1, Ordering::SeqCst));
        let subscription = QueueSubscription {
            id: sub_id.clone(),
            topic,
            queue_name,
            active: false,
        };

        self.subscriptions
            .write()
            .await
            .insert(sub_id.clone(), subscription.clone());

        Ok(subscription)
    }

    /// Unsubscribes and removes the dedicated queue.
    pub async fn unsubscribe(&self, subscription_id: &str) -> PubSubResult<bool> {
        let subscription = {
            let subscriptions = self.subscriptions.read().await;
            subscriptions.get(subscription_id).cloned()
        };

        let subscription = match subscription {
            Some(s) => s,
            None => return Ok(false),
        };

        // Stop consumer
        self.active_consumers.write().await.remove(subscription_id);

        // Remove queue from topic
        self.topics
            .write()
            .await
            .get_mut(&subscription.topic)
            .map(|s| s.remove(&subscription.queue_name));

        // Delete the queue
        self.queue_manager
            .delete_queue(&subscription.queue_name)
            .await
            .map_err(|e| PubSubError::QueueError(format!("{:?}", e)))?;

        self.subscriptions.write().await.remove(subscription_id);
        Ok(true)
    }

    /// Publishes to a topic (enqueues to all subscriber queues).
    pub async fn publish(&self, topic: &str, data: T) -> PubSubResult<usize> {
        let subscribers = {
            let topics = self.topics.read().await;
            topics.get(topic).cloned().unwrap_or_default()
        };

        if subscribers.is_empty() {
            return Ok(0);
        }

        let mut count = 0;
        for queue_name in subscribers {
            if let Some(queue) = self.queue_manager.get_queue(&queue_name).await {
                if queue.enqueue(data.clone()).await.is_ok() {
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    /// Marks a consumer as active.
    pub async fn start_consumer(&self, subscription_id: &str) -> bool {
        let exists = self.subscriptions.read().await.contains_key(subscription_id);
        if exists {
            self.active_consumers.write().await.insert(subscription_id.to_string());
            if let Some(sub) = self.subscriptions.write().await.get_mut(subscription_id) {
                sub.active = true;
            }
            true
        } else {
            false
        }
    }

    /// Marks a consumer as inactive.
    pub async fn stop_consumer(&self, subscription_id: &str) {
        self.active_consumers.write().await.remove(subscription_id);
        if let Some(sub) = self.subscriptions.write().await.get_mut(subscription_id) {
            sub.active = false;
        }
    }

    /// Lists all topics.
    pub async fn list_topics(&self) -> Vec<(String, usize)> {
        self.topics
            .read()
            .await
            .iter()
            .map(|(name, subs)| (name.clone(), subs.len()))
            .collect()
    }

    /// Lists subscriptions for a topic.
    pub async fn list_subscriptions(&self, topic: Option<&str>) -> Vec<QueueSubscription> {
        let subscriptions = self.subscriptions.read().await;
        subscriptions
            .values()
            .filter(|s| topic.map_or(true, |t| s.topic == t))
            .cloned()
            .collect()
    }

    /// Clears all state.
    pub async fn clear(&self) -> PubSubResult<()> {
        // Stop all consumers
        self.active_consumers.write().await.clear();

        // Delete all subscription queues
        let subscriptions: Vec<QueueSubscription> = {
            self.subscriptions.read().await.values().cloned().collect()
        };

        for subscription in subscriptions {
            self.queue_manager
                .delete_queue(&subscription.queue_name)
                .await
                .map_err(|e| PubSubError::QueueError(format!("{:?}", e)))?;
        }

        self.topics.write().await.clear();
        self.subscriptions.write().await.clear();

        Ok(())
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[tokio::test]
    async fn test_message_filter() {
        let filter = MessageFilter::<String>::new()
            .with_header("priority", "high")
            .with_custom(|msg: &PublishedMessage<String>| msg.data.len() > 3);

        let mut headers = HashMap::new();
        headers.insert("priority".to_string(), "high".to_string());

        let msg1 = PublishedMessage {
            id: "1".to_string(),
            topic: "test".to_string(),
            data: "hello".to_string(),
            timestamp: Instant::now(),
            headers: headers.clone(),
        };

        let msg2 = PublishedMessage {
            id: "2".to_string(),
            topic: "test".to_string(),
            data: "hi".to_string(), // Too short
            timestamp: Instant::now(),
            headers: headers.clone(),
        };

        let msg3 = PublishedMessage {
            id: "3".to_string(),
            topic: "test".to_string(),
            data: "hello".to_string(),
            timestamp: Instant::now(),
            headers: HashMap::new(), // Missing header
        };

        assert!(filter.matches(&msg1));
        assert!(!filter.matches(&msg2));
        assert!(!filter.matches(&msg3));
    }

    #[tokio::test]
    async fn test_broker_topic_management() {
        let broker = PubSubBroker::<String>::new(BrokerOptions {
            auto_create_topics: false,
            message_retention: None,
        });

        // Create topic
        let topic = broker.create_topic("events").await.unwrap();
        assert_eq!(topic.name, "events");
        assert_eq!(topic.subscriber_count, 0);

        // Duplicate topic should fail
        let result = broker.create_topic("events").await;
        assert!(matches!(result, Err(PubSubError::TopicExists(_))));

        // Get topic
        let topic = broker.get_topic("events").await;
        assert!(topic.is_some());

        // List topics
        let topics = broker.list_topics().await;
        assert_eq!(topics.len(), 1);

        // Delete topic
        let deleted = broker.delete_topic("events").await.unwrap();
        assert!(deleted);

        let topics = broker.list_topics().await;
        assert!(topics.is_empty());
    }

    #[tokio::test]
    async fn test_broker_subscribe_unsubscribe() {
        let broker = PubSubBroker::<String>::new(BrokerOptions::default());

        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        // Subscribe
        let sub_id = broker
            .subscribe(
                "events",
                move |_msg| {
                    let c = counter_clone.clone();
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                    }
                },
                None,
            )
            .await
            .unwrap();

        // Verify subscription
        let sub = broker.get_subscription(&sub_id).await;
        assert!(sub.is_some());
        assert_eq!(sub.unwrap().topic, "events");

        // Publish
        let result = broker.publish("events", "test".to_string(), None).await.unwrap();
        assert_eq!(result.delivered, 1);

        // Wait a bit for async delivery
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // Unsubscribe
        let unsubbed = broker.unsubscribe(&sub_id).await.unwrap();
        assert!(unsubbed);

        // Publish again (no subscribers)
        let result = broker.publish("events", "test2".to_string(), None).await.unwrap();
        assert_eq!(result.delivered, 0);
    }

    #[tokio::test]
    async fn test_broker_pause_resume() {
        let broker = PubSubBroker::<String>::new(BrokerOptions::default());

        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        let sub_id = broker
            .subscribe(
                "events",
                move |_msg| {
                    let c = counter_clone.clone();
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                    }
                },
                None,
            )
            .await
            .unwrap();

        // Pause
        broker.pause(&sub_id).await;

        // Publish (should not deliver)
        broker.publish("events", "test".to_string(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(counter.load(Ordering::SeqCst), 0);

        // Resume
        broker.resume(&sub_id).await;

        // Publish (should deliver)
        broker.publish("events", "test".to_string(), None).await.unwrap();
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_broker_filtering() {
        let broker = PubSubBroker::<String>::new(BrokerOptions::default());

        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        // Subscribe with filter
        let filter = MessageFilter::new()
            .with_header("priority", "high");

        broker
            .subscribe(
                "events",
                move |_msg| {
                    let c = counter_clone.clone();
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                    }
                },
                Some(filter),
            )
            .await
            .unwrap();

        // Publish without matching header (should filter)
        let result = broker.publish("events", "test".to_string(), None).await.unwrap();
        assert_eq!(result.filtered, 1);
        assert_eq!(result.delivered, 0);

        // Publish with matching header
        let mut headers = HashMap::new();
        headers.insert("priority".to_string(), "high".to_string());
        let result = broker.publish("events", "test".to_string(), Some(headers)).await.unwrap();
        assert_eq!(result.filtered, 0);
        assert_eq!(result.delivered, 1);
    }

    #[tokio::test]
    async fn test_broker_message_retention() {
        let broker = PubSubBroker::<String>::new(BrokerOptions {
            auto_create_topics: true,
            message_retention: Some(Duration::from_secs(60)),
        });

        // Publish some messages
        broker.publish("events", "msg1".to_string(), None).await.unwrap();
        broker.publish("events", "msg2".to_string(), None).await.unwrap();
        broker.publish("events", "msg3".to_string(), None).await.unwrap();

        // Get history
        let history = broker.get_history("events", 10).await;
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].data, "msg1");
        assert_eq!(history[2].data, "msg3");

        // Get limited history
        let history = broker.get_history("events", 2).await;
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].data, "msg2");
    }

    #[tokio::test]
    async fn test_broker_stats() {
        let broker = PubSubBroker::<String>::new(BrokerOptions::default());

        // Create topics and subscriptions
        broker.create_topic("topic1").await.unwrap();
        broker.create_topic("topic2").await.unwrap();

        broker
            .subscribe("topic1", |_| async {}, None)
            .await
            .unwrap();
        broker
            .subscribe("topic1", |_| async {}, None)
            .await
            .unwrap();

        // Publish
        broker.publish("topic1", "test".to_string(), None).await.unwrap();

        let stats = broker.get_stats().await;
        assert_eq!(stats.topics, 2);
        assert_eq!(stats.subscriptions, 2);
        assert_eq!(stats.published, 1);
        assert_eq!(stats.delivered, 2);
    }

    #[tokio::test]
    async fn test_broker_auto_create_topics() {
        // With auto-create enabled
        let broker = PubSubBroker::<String>::new(BrokerOptions {
            auto_create_topics: true,
            message_retention: None,
        });

        // Should auto-create topic on publish
        broker.publish("auto-topic", "test".to_string(), None).await.unwrap();
        let topic = broker.get_topic("auto-topic").await;
        assert!(topic.is_some());

        // With auto-create disabled
        let broker = PubSubBroker::<String>::new(BrokerOptions {
            auto_create_topics: false,
            message_retention: None,
        });

        // Should fail on publish to non-existent topic
        let result = broker.publish("auto-topic", "test".to_string(), None).await;
        assert!(matches!(result, Err(PubSubError::TopicNotFound(_))));
    }

    #[tokio::test]
    async fn test_publish_many() {
        let broker = PubSubBroker::<String>::new(BrokerOptions::default());

        broker.create_topic("topic1").await.unwrap();
        broker.create_topic("topic2").await.unwrap();

        let results = broker
            .publish_many(&["topic1", "topic2"], "test".to_string(), None)
            .await;

        assert_eq!(results.len(), 2);
        assert!(results.get("topic1").unwrap().is_ok());
        assert!(results.get("topic2").unwrap().is_ok());
    }
}
