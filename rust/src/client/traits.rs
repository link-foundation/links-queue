//! Client traits and types for Links Queue TCP client.
//!
//! This module provides the core traits and configuration types for the
//! TCP client implementation.

use std::fmt::Debug;
use std::future::Future;
use std::time::Duration;

use crate::{Link, LinkType, QueueOptions, QueueStats};

// =============================================================================
// Client Configuration
// =============================================================================

/// Configuration for the Links Queue TCP client.
///
/// # Examples
///
/// ```rust
/// use links_queue::client::ClientConfig;
/// use std::time::Duration;
///
/// let config = ClientConfig::new()
///     .with_connect_timeout(Duration::from_secs(10))
///     .with_request_timeout(Duration::from_secs(30))
///     .with_auto_reconnect(true);
/// ```
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// Connection timeout.
    /// Defaults to 10 seconds.
    pub connect_timeout: Duration,

    /// Request timeout.
    /// Defaults to 30 seconds.
    pub request_timeout: Duration,

    /// Whether to automatically reconnect on connection loss.
    /// Defaults to true.
    pub auto_reconnect: bool,

    /// Maximum number of reconnection attempts.
    /// Defaults to 5.
    pub max_reconnect_attempts: u32,

    /// Delay between reconnection attempts.
    /// Defaults to 1 second.
    pub reconnect_delay: Duration,

    /// Whether to use exponential backoff for reconnection.
    /// Defaults to true.
    pub exponential_backoff: bool,

    /// Maximum reconnection delay when using exponential backoff.
    /// Defaults to 30 seconds.
    pub max_reconnect_delay: Duration,

    /// Heartbeat interval for connection health.
    /// Defaults to 15 seconds.
    pub heartbeat_interval: Duration,

    /// Read buffer size.
    /// Defaults to 8KB.
    pub buffer_size: usize,

    /// Whether to enable TCP nodelay.
    /// Defaults to true.
    pub tcp_nodelay: bool,
}

impl ClientConfig {
    /// Creates a new client configuration with defaults.
    #[inline]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the connection timeout.
    #[inline]
    #[must_use]
    pub const fn with_connect_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }

    /// Sets the request timeout.
    #[inline]
    #[must_use]
    pub const fn with_request_timeout(mut self, timeout: Duration) -> Self {
        self.request_timeout = timeout;
        self
    }

    /// Sets whether to auto-reconnect.
    #[inline]
    #[must_use]
    pub const fn with_auto_reconnect(mut self, enabled: bool) -> Self {
        self.auto_reconnect = enabled;
        self
    }

    /// Sets the maximum reconnection attempts.
    #[inline]
    #[must_use]
    pub const fn with_max_reconnect_attempts(mut self, attempts: u32) -> Self {
        self.max_reconnect_attempts = attempts;
        self
    }

    /// Sets the reconnection delay.
    #[inline]
    #[must_use]
    pub const fn with_reconnect_delay(mut self, delay: Duration) -> Self {
        self.reconnect_delay = delay;
        self
    }

    /// Sets whether to use exponential backoff.
    #[inline]
    #[must_use]
    pub const fn with_exponential_backoff(mut self, enabled: bool) -> Self {
        self.exponential_backoff = enabled;
        self
    }

    /// Sets the heartbeat interval.
    #[inline]
    #[must_use]
    pub const fn with_heartbeat_interval(mut self, interval: Duration) -> Self {
        self.heartbeat_interval = interval;
        self
    }

    /// Sets the buffer size.
    #[inline]
    #[must_use]
    pub const fn with_buffer_size(mut self, size: usize) -> Self {
        self.buffer_size = size;
        self
    }

    /// Sets whether to enable TCP nodelay.
    #[inline]
    #[must_use]
    pub const fn with_tcp_nodelay(mut self, enabled: bool) -> Self {
        self.tcp_nodelay = enabled;
        self
    }
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(10),
            request_timeout: Duration::from_secs(30),
            auto_reconnect: true,
            max_reconnect_attempts: 5,
            reconnect_delay: Duration::from_secs(1),
            exponential_backoff: true,
            max_reconnect_delay: Duration::from_secs(30),
            heartbeat_interval: Duration::from_secs(15),
            buffer_size: 8192,
            tcp_nodelay: true,
        }
    }
}

// =============================================================================
// Client Error Types
// =============================================================================

/// Error codes for client operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientErrorCode {
    /// Failed to connect to the server.
    ConnectionFailed,
    /// Already connected.
    AlreadyConnected,
    /// Not connected to a server.
    NotConnected,
    /// Connection was lost.
    ConnectionLost,
    /// Request timed out.
    Timeout,
    /// Protocol error (invalid response format).
    ProtocolError,
    /// Server returned an error.
    ServerError,
    /// Invalid address format.
    InvalidAddress,
    /// I/O error.
    IoError,
}

impl std::fmt::Display for ClientErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionFailed => write!(f, "CONNECTION_FAILED"),
            Self::AlreadyConnected => write!(f, "ALREADY_CONNECTED"),
            Self::NotConnected => write!(f, "NOT_CONNECTED"),
            Self::ConnectionLost => write!(f, "CONNECTION_LOST"),
            Self::Timeout => write!(f, "TIMEOUT"),
            Self::ProtocolError => write!(f, "PROTOCOL_ERROR"),
            Self::ServerError => write!(f, "SERVER_ERROR"),
            Self::InvalidAddress => write!(f, "INVALID_ADDRESS"),
            Self::IoError => write!(f, "IO_ERROR"),
        }
    }
}

/// Error returned by client operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientError {
    /// The error code identifying the type of error.
    pub code: ClientErrorCode,
    /// Human-readable error message.
    pub message: String,
}

impl ClientError {
    /// Creates a new `ClientError`.
    #[inline]
    pub fn new(code: ClientErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Creates a "connection failed" error.
    #[inline]
    #[must_use]
    pub fn connection_failed(address: &str, reason: &str) -> Self {
        Self::new(
            ClientErrorCode::ConnectionFailed,
            format!("Failed to connect to {address}: {reason}"),
        )
    }

    /// Creates an "already connected" error.
    #[inline]
    #[must_use]
    pub fn already_connected() -> Self {
        Self::new(ClientErrorCode::AlreadyConnected, "Already connected")
    }

    /// Creates a "not connected" error.
    #[inline]
    #[must_use]
    pub fn not_connected() -> Self {
        Self::new(ClientErrorCode::NotConnected, "Not connected to server")
    }

    /// Creates a "connection lost" error.
    #[inline]
    #[must_use]
    pub fn connection_lost(reason: &str) -> Self {
        Self::new(
            ClientErrorCode::ConnectionLost,
            format!("Connection lost: {reason}"),
        )
    }

    /// Creates a "timeout" error.
    #[inline]
    #[must_use]
    pub fn timeout(operation: &str) -> Self {
        Self::new(
            ClientErrorCode::Timeout,
            format!("Operation timed out: {operation}"),
        )
    }

    /// Creates a "protocol error".
    #[inline]
    #[must_use]
    pub fn protocol_error(details: &str) -> Self {
        Self::new(
            ClientErrorCode::ProtocolError,
            format!("Protocol error: {details}"),
        )
    }

    /// Creates a "server error".
    #[inline]
    #[must_use]
    pub fn server_error(message: &str, code: &str) -> Self {
        Self::new(
            ClientErrorCode::ServerError,
            format!("Server error [{code}]: {message}"),
        )
    }

    /// Creates an "invalid address" error.
    #[inline]
    #[must_use]
    pub fn invalid_address(address: &str) -> Self {
        Self::new(
            ClientErrorCode::InvalidAddress,
            format!("Invalid server address: {address}"),
        )
    }

    /// Creates an "I/O error".
    #[inline]
    #[must_use]
    pub fn io_error(details: &str) -> Self {
        Self::new(ClientErrorCode::IoError, format!("I/O error: {details}"))
    }
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ClientError {}

impl From<std::io::Error> for ClientError {
    fn from(err: std::io::Error) -> Self {
        Self::io_error(&err.to_string())
    }
}

/// Result type for client operations.
pub type ClientResult<T> = Result<T, ClientError>;

// =============================================================================
// Subscription
// =============================================================================

/// A subscription to queue updates.
///
/// Provides an async stream of links as they are published to the queue.
pub struct Subscription<T: LinkType> {
    /// Queue name this subscription is for.
    queue: String,

    /// Whether the subscription is active.
    active: bool,

    /// Phantom data for type parameter.
    _marker: std::marker::PhantomData<T>,
}

impl<T: LinkType> Subscription<T> {
    /// Creates a new subscription.
    pub(crate) fn new(queue: String) -> Self {
        Self {
            queue,
            active: true,
            _marker: std::marker::PhantomData,
        }
    }

    /// Returns the queue name.
    #[must_use]
    pub fn queue(&self) -> &str {
        &self.queue
    }

    /// Returns whether the subscription is active.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Cancels the subscription.
    pub fn cancel(&mut self) {
        self.active = false;
    }

    /// Gets the next link from the subscription.
    ///
    /// Returns `None` if the subscription is cancelled or the connection is closed.
    pub async fn next(&mut self) -> Option<Link<T>> {
        if !self.active {
            return None;
        }

        // In a real implementation, this would wait for the next message
        // from the server. For now, we just return None.
        None
    }
}

impl<T: LinkType> Debug for Subscription<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Subscription")
            .field("queue", &self.queue)
            .field("active", &self.active)
            .finish()
    }
}

// =============================================================================
// LinksQueueClient Trait
// =============================================================================

/// Trait for the Links Queue TCP client.
///
/// The client connects to a Links Queue server and provides methods for
/// performing queue operations over the network.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::client::{LinksQueueClient, ClientConfig};
///
/// async fn use_client<T, C>(client: &C) -> Result<(), Box<dyn std::error::Error>>
/// where
///     T: LinkType,
///     C: LinksQueueClient<T>,
/// {
///     // Create a queue
///     client.create_queue("tasks", Default::default()).await?;
///
///     // Enqueue a link
///     let link = Link::new(1, LinkRef::Id(2), LinkRef::Id(3));
///     client.enqueue("tasks", link).await?;
///
///     // Dequeue and process
///     if let Some(link) = client.dequeue("tasks").await? {
///         println!("Received: {:?}", link);
///         client.acknowledge("tasks", link.id).await?;
///     }
///
///     Ok(())
/// }
/// ```
pub trait LinksQueueClient<T: LinkType>: Send + Sync {
    /// Returns the client configuration.
    fn config(&self) -> &ClientConfig;

    /// Returns whether the client is connected.
    fn is_connected(&self) -> bool;

    /// Returns the server address if connected.
    fn server_address(&self) -> Option<String>;

    // -------------------------------------------------------------------------
    // Connection Management
    // -------------------------------------------------------------------------

    /// Connects to the server at the given address.
    ///
    /// Address format: `tcp://host:port` or `host:port`
    ///
    /// # Errors
    ///
    /// Returns an error if connection fails or times out.
    fn connect(address: &str) -> impl Future<Output = ClientResult<Self>> + Send
    where
        Self: Sized;

    /// Connects with a custom configuration.
    fn connect_with_config(
        address: &str,
        config: ClientConfig,
    ) -> impl Future<Output = ClientResult<Self>> + Send
    where
        Self: Sized;

    /// Disconnects from the server.
    fn disconnect(&self) -> impl Future<Output = ClientResult<()>> + Send;

    /// Sends a ping and returns the round-trip time.
    fn ping(&self) -> impl Future<Output = ClientResult<Duration>> + Send;

    // -------------------------------------------------------------------------
    // Queue Management
    // -------------------------------------------------------------------------

    /// Creates a new queue.
    fn create_queue(
        &self,
        name: &str,
        options: QueueOptions,
    ) -> impl Future<Output = ClientResult<()>> + Send;

    /// Deletes a queue.
    fn delete_queue(&self, name: &str) -> impl Future<Output = ClientResult<bool>> + Send;

    /// Gets queue information.
    fn get_queue(&self, name: &str)
        -> impl Future<Output = ClientResult<Option<QueueInfo>>> + Send;

    /// Lists all queues.
    fn list_queues(&self) -> impl Future<Output = ClientResult<Vec<String>>> + Send;

    // -------------------------------------------------------------------------
    // Queue Operations
    // -------------------------------------------------------------------------

    /// Enqueues a link to the specified queue.
    fn enqueue(
        &self,
        queue: &str,
        link: Link<T>,
    ) -> impl Future<Output = ClientResult<EnqueueResult<T>>> + Send;

    /// Dequeues a link from the specified queue.
    fn dequeue(&self, queue: &str) -> impl Future<Output = ClientResult<Option<Link<T>>>> + Send;

    /// Peeks at the next link without dequeuing.
    fn peek(&self, queue: &str) -> impl Future<Output = ClientResult<Option<Link<T>>>> + Send;

    /// Acknowledges a dequeued link.
    fn acknowledge(&self, queue: &str, id: T) -> impl Future<Output = ClientResult<()>> + Send;

    /// Rejects a dequeued link.
    fn reject(
        &self,
        queue: &str,
        id: T,
        requeue: bool,
    ) -> impl Future<Output = ClientResult<()>> + Send;

    /// Gets queue statistics.
    fn stats(&self, queue: &str) -> impl Future<Output = ClientResult<QueueStats>> + Send;

    // -------------------------------------------------------------------------
    // Subscriptions
    // -------------------------------------------------------------------------

    /// Subscribes to queue updates.
    fn subscribe(&self, queue: &str) -> impl Future<Output = ClientResult<Subscription<T>>> + Send;

    /// Unsubscribes from queue updates.
    fn unsubscribe(
        &self,
        subscription: Subscription<T>,
    ) -> impl Future<Output = ClientResult<()>> + Send;
}

// =============================================================================
// Queue Info (Client-side representation)
// =============================================================================

/// Queue information returned by the client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueInfo {
    /// Queue name.
    pub name: String,
    /// Current queue depth.
    pub depth: usize,
}

impl QueueInfo {
    /// Creates a new `QueueInfo`.
    #[must_use]
    pub fn new(name: String, depth: usize) -> Self {
        Self { name, depth }
    }
}

// =============================================================================
// Enqueue Result (Client-side representation)
// =============================================================================

/// Result of an enqueue operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnqueueResult<T: LinkType> {
    /// The ID assigned to the enqueued link.
    pub id: T,
    /// The position in the queue.
    pub position: usize,
}

impl<T: LinkType> EnqueueResult<T> {
    /// Creates a new `EnqueueResult`.
    #[must_use]
    pub fn new(id: T, position: usize) -> Self {
        Self { id, position }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod client_config_tests {
        use super::*;

        #[test]
        fn test_client_config_default() {
            let config = ClientConfig::default();
            assert_eq!(config.connect_timeout, Duration::from_secs(10));
            assert_eq!(config.request_timeout, Duration::from_secs(30));
            assert!(config.auto_reconnect);
        }

        #[test]
        fn test_client_config_builder() {
            let config = ClientConfig::new()
                .with_connect_timeout(Duration::from_secs(5))
                .with_auto_reconnect(false)
                .with_max_reconnect_attempts(3);

            assert_eq!(config.connect_timeout, Duration::from_secs(5));
            assert!(!config.auto_reconnect);
            assert_eq!(config.max_reconnect_attempts, 3);
        }
    }

    mod client_error_tests {
        use super::*;

        #[test]
        fn test_client_error_code_display() {
            assert_eq!(
                format!("{}", ClientErrorCode::ConnectionFailed),
                "CONNECTION_FAILED"
            );
            assert_eq!(
                format!("{}", ClientErrorCode::NotConnected),
                "NOT_CONNECTED"
            );
            assert_eq!(format!("{}", ClientErrorCode::Timeout), "TIMEOUT");
        }

        #[test]
        fn test_client_error_factories() {
            let err = ClientError::connection_failed("localhost:5000", "refused");
            assert_eq!(err.code, ClientErrorCode::ConnectionFailed);
            assert!(err.message.contains("localhost:5000"));

            let err = ClientError::timeout("enqueue");
            assert_eq!(err.code, ClientErrorCode::Timeout);

            let err = ClientError::server_error("Queue not found", "QUEUE_NOT_FOUND");
            assert_eq!(err.code, ClientErrorCode::ServerError);
            assert!(err.message.contains("QUEUE_NOT_FOUND"));
        }

        #[test]
        fn test_client_error_display() {
            let err = ClientError::connection_failed("localhost:5000", "refused");
            let display = format!("{err}");
            assert!(display.contains("CONNECTION_FAILED"));
            assert!(display.contains("localhost:5000"));
        }
    }

    mod subscription_tests {
        use super::*;

        #[test]
        fn test_subscription_new() {
            let sub = Subscription::<u64>::new("test-queue".to_string());
            assert_eq!(sub.queue(), "test-queue");
            assert!(sub.is_active());
        }

        #[test]
        fn test_subscription_cancel() {
            let mut sub = Subscription::<u64>::new("test-queue".to_string());
            assert!(sub.is_active());
            sub.cancel();
            assert!(!sub.is_active());
        }
    }

    mod queue_info_tests {
        use super::*;

        #[test]
        fn test_queue_info_new() {
            let info = QueueInfo::new("tasks".to_string(), 42);
            assert_eq!(info.name, "tasks");
            assert_eq!(info.depth, 42);
        }
    }

    mod enqueue_result_tests {
        use super::*;

        #[test]
        fn test_enqueue_result_new() {
            let result = EnqueueResult::new(123u64, 5);
            assert_eq!(result.id, 123);
            assert_eq!(result.position, 5);
        }
    }
}
