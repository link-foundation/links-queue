//! Router module for topic-based message routing.
//!
//! This module provides AMQP-style message routing functionality:
//! - **Topic Matching**: Pattern matching with wildcards (* and #)
//! - **Exchange Types**: Direct, Topic, Fanout, and Headers exchanges
//! - **Router**: Central routing management
//! - **Routed Queue Manager**: Queue management with routing integration
//!
//! # Wildcard Syntax
//!
//! - `*` (asterisk): Matches exactly one word
//! - `#` (hash): Matches zero or more words
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::features::{Router, TopicMatcher, ExchangeType};
//!
//! // Pattern matching
//! assert!(TopicMatcher::matches("logs.*", "logs.error"));
//! assert!(TopicMatcher::matches("logs.#", "logs.error.db"));
//!
//! // Create a router
//! let router = Router::new();
//! router.declare_exchange("events", ExchangeType::Topic);
//! router.bind("events", "error-queue", "logs.error");
//! ```

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};

use crate::{Link, LinkType, Queue, QueueResult, QueueManager, QueueOptions, QueueInfo, EnqueueResult};

// =============================================================================
// Exchange Types
// =============================================================================

/// Types of message exchanges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ExchangeType {
    /// Routes to queues with exact routing key match
    Direct,
    /// Routes using pattern matching with wildcards
    Topic,
    /// Routes to all bound queues (ignores routing key)
    Fanout,
    /// Routes based on message headers
    Headers,
}

impl std::fmt::Display for ExchangeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Direct => write!(f, "direct"),
            Self::Topic => write!(f, "topic"),
            Self::Fanout => write!(f, "fanout"),
            Self::Headers => write!(f, "headers"),
        }
    }
}

// =============================================================================
// Topic Matcher
// =============================================================================

/// Utility for matching routing keys against topic patterns.
pub struct TopicMatcher;

impl TopicMatcher {
    /// Checks if a routing key matches a pattern.
    ///
    /// # Wildcard Rules
    ///
    /// - `*` matches exactly one word
    /// - `#` matches zero or more words
    /// - Words are separated by `.`
    ///
    /// # Examples
    ///
    /// ```rust,ignore
    /// assert!(TopicMatcher::matches("logs.*", "logs.error"));
    /// assert!(!TopicMatcher::matches("logs.*", "logs.error.db"));
    /// assert!(TopicMatcher::matches("logs.#", "logs.error.db"));
    /// assert!(TopicMatcher::matches("#", "anything.goes.here"));
    /// ```
    pub fn matches(pattern: &str, routing_key: &str) -> bool {
        // Special case: # matches everything
        if pattern == "#" {
            return !routing_key.is_empty();
        }

        let pattern_parts: Vec<&str> = pattern.split('.').collect();
        let key_parts: Vec<&str> = routing_key.split('.').collect();

        Self::match_parts(&pattern_parts, &key_parts)
    }

    fn match_parts(pattern: &[&str], key: &[&str]) -> bool {
        let mut pi = 0; // Pattern index
        let mut ki = 0; // Key index

        while pi < pattern.len() {
            let part = pattern[pi];

            if part == "#" {
                // # at end matches rest
                if pi == pattern.len() - 1 {
                    return true;
                }

                // Try matching # with different lengths
                for k in ki..=key.len() {
                    if Self::match_parts(&pattern[pi + 1..], &key[k..]) {
                        return true;
                    }
                }
                return false;
            } else if part == "*" {
                // * must match exactly one word
                if ki >= key.len() {
                    return false;
                }
                pi += 1;
                ki += 1;
            } else {
                // Exact match required
                if ki >= key.len() || part != key[ki] {
                    return false;
                }
                pi += 1;
                ki += 1;
            }
        }

        // Both must be exhausted
        pi == pattern.len() && ki == key.len()
    }

    /// Calculates the specificity score of a pattern.
    ///
    /// Higher scores indicate more specific patterns.
    /// - Exact words: 100 points
    /// - `*` wildcard: 10 points
    /// - `#` wildcard: 1 point
    pub fn specificity(pattern: &str) -> u32 {
        let mut score = 0;
        for part in pattern.split('.') {
            score += match part {
                "#" => 1,
                "*" => 10,
                _ => 100,
            };
        }
        score
    }
}

// =============================================================================
// Binding
// =============================================================================

/// A binding between an exchange and a queue.
#[derive(Debug, Clone)]
pub struct Binding {
    /// Exchange name
    pub exchange: String,
    /// Queue name
    pub queue: String,
    /// Routing key or pattern
    pub routing_key: String,
    /// Headers for headers exchange (key -> value)
    pub headers: Option<HashMap<String, String>>,
    /// Match type for headers (all or any)
    pub headers_match_all: bool,
}

impl Binding {
    /// Creates a new binding.
    pub fn new(exchange: &str, queue: &str, routing_key: &str) -> Self {
        Self {
            exchange: exchange.to_string(),
            queue: queue.to_string(),
            routing_key: routing_key.to_string(),
            headers: None,
            headers_match_all: true,
        }
    }

    /// Creates a binding with headers.
    pub fn with_headers(
        exchange: &str,
        queue: &str,
        headers: HashMap<String, String>,
        match_all: bool,
    ) -> Self {
        Self {
            exchange: exchange.to_string(),
            queue: queue.to_string(),
            routing_key: String::new(),
            headers: Some(headers),
            headers_match_all: match_all,
        }
    }
}

// =============================================================================
// Exchange Trait
// =============================================================================

/// Trait for exchange implementations.
pub trait Exchange: Send + Sync {
    /// Returns the exchange name.
    fn name(&self) -> &str;

    /// Returns the exchange type.
    fn exchange_type(&self) -> ExchangeType;

    /// Binds a queue to this exchange.
    fn bind(&self, queue: &str, routing_key: &str, headers: Option<(HashMap<String, String>, bool)>) -> Binding;

    /// Unbinds a queue from this exchange.
    fn unbind(&self, queue: &str, routing_key: &str) -> bool;

    /// Routes a message and returns matching queue names.
    fn route(&self, routing_key: &str, headers: Option<&HashMap<String, String>>) -> Vec<String>;

    /// Returns all bindings.
    fn get_bindings(&self) -> Vec<Binding>;

    /// Clears all bindings.
    fn clear(&self);
}

// =============================================================================
// Direct Exchange
// =============================================================================

/// Direct exchange: routes to queues with exact routing key match.
pub struct DirectExchange {
    name: String,
    /// Routing key -> Set of queue names
    bindings: RwLock<HashMap<String, HashSet<String>>>,
}

impl DirectExchange {
    /// Creates a new direct exchange.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            bindings: RwLock::new(HashMap::new()),
        }
    }
}

impl Exchange for DirectExchange {
    fn name(&self) -> &str {
        &self.name
    }

    fn exchange_type(&self) -> ExchangeType {
        ExchangeType::Direct
    }

    fn bind(&self, queue: &str, routing_key: &str, _headers: Option<(HashMap<String, String>, bool)>) -> Binding {
        let mut bindings = self.bindings.write().unwrap();
        bindings
            .entry(routing_key.to_string())
            .or_insert_with(HashSet::new)
            .insert(queue.to_string());
        Binding::new(&self.name, queue, routing_key)
    }

    fn unbind(&self, queue: &str, routing_key: &str) -> bool {
        let mut bindings = self.bindings.write().unwrap();
        if let Some(queues) = bindings.get_mut(routing_key) {
            let removed = queues.remove(queue);
            if queues.is_empty() {
                bindings.remove(routing_key);
            }
            removed
        } else {
            false
        }
    }

    fn route(&self, routing_key: &str, _headers: Option<&HashMap<String, String>>) -> Vec<String> {
        let bindings = self.bindings.read().unwrap();
        bindings
            .get(routing_key)
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn get_bindings(&self) -> Vec<Binding> {
        let bindings = self.bindings.read().unwrap();
        let mut result = Vec::new();
        for (key, queues) in bindings.iter() {
            for queue in queues {
                result.push(Binding::new(&self.name, queue, key));
            }
        }
        result
    }

    fn clear(&self) {
        self.bindings.write().unwrap().clear();
    }
}

// =============================================================================
// Topic Exchange
// =============================================================================

/// Topic exchange: routes using pattern matching with wildcards.
pub struct TopicExchange {
    name: String,
    /// Pattern -> Set of queue names
    bindings: RwLock<HashMap<String, HashSet<String>>>,
}

impl TopicExchange {
    /// Creates a new topic exchange.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            bindings: RwLock::new(HashMap::new()),
        }
    }
}

impl Exchange for TopicExchange {
    fn name(&self) -> &str {
        &self.name
    }

    fn exchange_type(&self) -> ExchangeType {
        ExchangeType::Topic
    }

    fn bind(&self, queue: &str, routing_key: &str, _headers: Option<(HashMap<String, String>, bool)>) -> Binding {
        let mut bindings = self.bindings.write().unwrap();
        bindings
            .entry(routing_key.to_string())
            .or_insert_with(HashSet::new)
            .insert(queue.to_string());
        Binding::new(&self.name, queue, routing_key)
    }

    fn unbind(&self, queue: &str, routing_key: &str) -> bool {
        let mut bindings = self.bindings.write().unwrap();
        if let Some(queues) = bindings.get_mut(routing_key) {
            let removed = queues.remove(queue);
            if queues.is_empty() {
                bindings.remove(routing_key);
            }
            removed
        } else {
            false
        }
    }

    fn route(&self, routing_key: &str, _headers: Option<&HashMap<String, String>>) -> Vec<String> {
        let bindings = self.bindings.read().unwrap();
        let mut result = HashSet::new();

        for (pattern, queues) in bindings.iter() {
            if TopicMatcher::matches(pattern, routing_key) {
                result.extend(queues.iter().cloned());
            }
        }

        result.into_iter().collect()
    }

    fn get_bindings(&self) -> Vec<Binding> {
        let bindings = self.bindings.read().unwrap();
        let mut result = Vec::new();
        for (key, queues) in bindings.iter() {
            for queue in queues {
                result.push(Binding::new(&self.name, queue, key));
            }
        }
        result
    }

    fn clear(&self) {
        self.bindings.write().unwrap().clear();
    }
}

// =============================================================================
// Fanout Exchange
// =============================================================================

/// Fanout exchange: routes to all bound queues (ignores routing key).
pub struct FanoutExchange {
    name: String,
    /// Set of bound queue names
    queues: RwLock<HashSet<String>>,
}

impl FanoutExchange {
    /// Creates a new fanout exchange.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            queues: RwLock::new(HashSet::new()),
        }
    }
}

impl Exchange for FanoutExchange {
    fn name(&self) -> &str {
        &self.name
    }

    fn exchange_type(&self) -> ExchangeType {
        ExchangeType::Fanout
    }

    fn bind(&self, queue: &str, _routing_key: &str, _headers: Option<(HashMap<String, String>, bool)>) -> Binding {
        self.queues.write().unwrap().insert(queue.to_string());
        Binding::new(&self.name, queue, "")
    }

    fn unbind(&self, queue: &str, _routing_key: &str) -> bool {
        self.queues.write().unwrap().remove(queue)
    }

    fn route(&self, _routing_key: &str, _headers: Option<&HashMap<String, String>>) -> Vec<String> {
        self.queues.read().unwrap().iter().cloned().collect()
    }

    fn get_bindings(&self) -> Vec<Binding> {
        let queues = self.queues.read().unwrap();
        queues.iter().map(|q| Binding::new(&self.name, q, "")).collect()
    }

    fn clear(&self) {
        self.queues.write().unwrap().clear();
    }
}

// =============================================================================
// Headers Exchange
// =============================================================================

/// Headers exchange: routes based on message headers.
pub struct HeadersExchange {
    name: String,
    /// List of (queue, headers, match_all) bindings
    bindings: RwLock<Vec<(String, HashMap<String, String>, bool)>>,
}

impl HeadersExchange {
    /// Creates a new headers exchange.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            bindings: RwLock::new(Vec::new()),
        }
    }
}

impl Exchange for HeadersExchange {
    fn name(&self) -> &str {
        &self.name
    }

    fn exchange_type(&self) -> ExchangeType {
        ExchangeType::Headers
    }

    fn bind(&self, queue: &str, _routing_key: &str, headers: Option<(HashMap<String, String>, bool)>) -> Binding {
        let (hdrs, match_all) = headers.unwrap_or_else(|| (HashMap::new(), true));
        self.bindings
            .write()
            .unwrap()
            .push((queue.to_string(), hdrs.clone(), match_all));
        Binding::with_headers(&self.name, queue, hdrs, match_all)
    }

    fn unbind(&self, queue: &str, _routing_key: &str) -> bool {
        let mut bindings = self.bindings.write().unwrap();
        let len_before = bindings.len();
        bindings.retain(|(q, _, _)| q != queue);
        bindings.len() < len_before
    }

    fn route(&self, _routing_key: &str, headers: Option<&HashMap<String, String>>) -> Vec<String> {
        let headers = match headers {
            Some(h) => h,
            None => return Vec::new(),
        };

        let bindings = self.bindings.read().unwrap();
        let mut result = HashSet::new();

        for (queue, required_headers, match_all) in bindings.iter() {
            let matches = if *match_all {
                // All headers must match
                required_headers
                    .iter()
                    .all(|(k, v)| headers.get(k) == Some(v))
            } else {
                // Any header must match
                required_headers
                    .iter()
                    .any(|(k, v)| headers.get(k) == Some(v))
            };

            if matches {
                result.insert(queue.clone());
            }
        }

        result.into_iter().collect()
    }

    fn get_bindings(&self) -> Vec<Binding> {
        let bindings = self.bindings.read().unwrap();
        bindings
            .iter()
            .map(|(q, h, m)| Binding::with_headers(&self.name, q, h.clone(), *m))
            .collect()
    }

    fn clear(&self) {
        self.bindings.write().unwrap().clear();
    }
}

// =============================================================================
// Router
// =============================================================================

/// Central router for managing exchanges and routing messages.
pub struct Router {
    /// Map of exchange name -> exchange
    exchanges: RwLock<HashMap<String, Arc<dyn Exchange>>>,
}

impl Router {
    /// Creates a new router.
    pub fn new() -> Self {
        Self {
            exchanges: RwLock::new(HashMap::new()),
        }
    }

    /// Declares an exchange.
    ///
    /// If an exchange with the same name exists and has the same type, it is returned.
    /// If it has a different type, an error is returned.
    pub fn declare_exchange(&self, name: &str, exchange_type: ExchangeType) -> Result<Arc<dyn Exchange>, String> {
        let mut exchanges = self.exchanges.write().unwrap();

        if let Some(existing) = exchanges.get(name) {
            if existing.exchange_type() == exchange_type {
                return Ok(Arc::clone(existing));
            } else {
                return Err(format!(
                    "Exchange '{}' exists with type {:?}, cannot redeclare as {:?}",
                    name,
                    existing.exchange_type(),
                    exchange_type
                ));
            }
        }

        let exchange: Arc<dyn Exchange> = match exchange_type {
            ExchangeType::Direct => Arc::new(DirectExchange::new(name)),
            ExchangeType::Topic => Arc::new(TopicExchange::new(name)),
            ExchangeType::Fanout => Arc::new(FanoutExchange::new(name)),
            ExchangeType::Headers => Arc::new(HeadersExchange::new(name)),
        };

        exchanges.insert(name.to_string(), Arc::clone(&exchange));
        Ok(exchange)
    }

    /// Gets an exchange by name.
    pub fn get_exchange(&self, name: &str) -> Option<Arc<dyn Exchange>> {
        self.exchanges.read().unwrap().get(name).cloned()
    }

    /// Deletes an exchange.
    pub fn delete_exchange(&self, name: &str) -> bool {
        self.exchanges.write().unwrap().remove(name).is_some()
    }

    /// Binds a queue to an exchange.
    pub fn bind(
        &self,
        exchange: &str,
        queue: &str,
        routing_key: &str,
        headers: Option<(HashMap<String, String>, bool)>,
    ) -> Result<Binding, String> {
        let exchanges = self.exchanges.read().unwrap();
        let ex = exchanges
            .get(exchange)
            .ok_or_else(|| format!("Exchange '{}' not found", exchange))?;
        Ok(ex.bind(queue, routing_key, headers))
    }

    /// Unbinds a queue from an exchange.
    pub fn unbind(&self, exchange: &str, queue: &str, routing_key: &str) -> bool {
        let exchanges = self.exchanges.read().unwrap();
        if let Some(ex) = exchanges.get(exchange) {
            ex.unbind(queue, routing_key)
        } else {
            false
        }
    }

    /// Routes a message through an exchange.
    pub fn route(
        &self,
        exchange: &str,
        routing_key: &str,
        headers: Option<&HashMap<String, String>>,
    ) -> Vec<String> {
        let exchanges = self.exchanges.read().unwrap();
        if let Some(ex) = exchanges.get(exchange) {
            ex.route(routing_key, headers)
        } else {
            Vec::new()
        }
    }

    /// Lists all exchanges.
    pub fn list_exchanges(&self) -> Vec<(String, ExchangeType, usize)> {
        let exchanges = self.exchanges.read().unwrap();
        exchanges
            .values()
            .map(|e| (e.name().to_string(), e.exchange_type(), e.get_bindings().len()))
            .collect()
    }

    /// Gets bindings for an exchange.
    pub fn get_bindings(&self, exchange: &str) -> Vec<Binding> {
        let exchanges = self.exchanges.read().unwrap();
        exchanges
            .get(exchange)
            .map(|e| e.get_bindings())
            .unwrap_or_default()
    }

    /// Clears all exchanges.
    pub fn clear(&self) {
        self.exchanges.write().unwrap().clear();
    }
}

impl Default for Router {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Routed Queue Manager
// =============================================================================

/// A queue manager with integrated routing support.
pub struct RoutedQueueManager<T, Q, M>
where
    T: LinkType,
    Q: Queue<T>,
    M: QueueManager<T, Q>,
{
    /// The underlying queue manager
    manager: M,
    /// The router
    router: Router,
    /// Phantom data
    _marker: std::marker::PhantomData<(T, Q)>,
}

impl<T, Q, M> RoutedQueueManager<T, Q, M>
where
    T: LinkType,
    Q: Queue<T>,
    M: QueueManager<T, Q>,
{
    /// Creates a new routed queue manager.
    pub fn new(manager: M) -> Self {
        Self {
            manager,
            router: Router::new(),
            _marker: std::marker::PhantomData,
        }
    }

    /// Creates a queue.
    pub async fn create_queue(&self, name: &str, options: QueueOptions) -> QueueResult<Q> {
        self.manager.create_queue(name, options).await
    }

    /// Gets a queue by name.
    pub async fn get_queue(&self, name: &str) -> QueueResult<Option<Q>> {
        self.manager.get_queue(name).await
    }

    /// Deletes a queue.
    pub async fn delete_queue(&self, name: &str) -> QueueResult<bool> {
        self.manager.delete_queue(name).await
    }

    /// Lists all queues.
    pub async fn list_queues(&self) -> QueueResult<Vec<QueueInfo>> {
        self.manager.list_queues().await
    }

    /// Declares an exchange.
    pub fn declare_exchange(&self, name: &str, exchange_type: ExchangeType) -> Result<Arc<dyn Exchange>, String> {
        self.router.declare_exchange(name, exchange_type)
    }

    /// Binds a queue to an exchange with a routing key.
    pub fn bind(&self, exchange: &str, queue: &str, routing_key: &str) -> Result<Binding, String> {
        self.router.bind(exchange, queue, routing_key, None)
    }

    /// Binds a queue to a topic exchange with a pattern.
    pub fn bind_topic(&self, exchange: &str, queue: &str, pattern: &str) -> Result<Binding, String> {
        self.router.bind(exchange, queue, pattern, None)
    }

    /// Unbinds a queue from an exchange.
    pub fn unbind(&self, exchange: &str, queue: &str, routing_key: &str) -> bool {
        self.router.unbind(exchange, queue, routing_key)
    }

    /// Publishes a message through an exchange.
    pub async fn publish(
        &self,
        exchange: &str,
        link: Link<T>,
        routing_key: &str,
    ) -> QueueResult<Vec<String>> {
        let queues = self.router.route(exchange, routing_key, None);

        for queue_name in &queues {
            if let Some(queue) = self.manager.get_queue(queue_name).await? {
                queue.enqueue(link.clone()).await?;
            }
        }

        Ok(queues)
    }

    /// Publishes a message with headers through an exchange.
    pub async fn publish_with_headers(
        &self,
        exchange: &str,
        link: Link<T>,
        routing_key: &str,
        headers: &HashMap<String, String>,
    ) -> QueueResult<Vec<String>> {
        let queues = self.router.route(exchange, routing_key, Some(headers));

        for queue_name in &queues {
            if let Some(queue) = self.manager.get_queue(queue_name).await? {
                queue.enqueue(link.clone()).await?;
            }
        }

        Ok(queues)
    }

    /// Sets up a fanout pattern: creates a fanout exchange and binds queues.
    pub fn fanout(&self, exchange: &str, queues: &[&str]) -> Result<(), String> {
        self.router.declare_exchange(exchange, ExchangeType::Fanout)?;
        for queue in queues {
            self.router.bind(exchange, queue, "", None)?;
        }
        Ok(())
    }

    /// Gets the router.
    pub fn router(&self) -> &Router {
        &self.router
    }
}

