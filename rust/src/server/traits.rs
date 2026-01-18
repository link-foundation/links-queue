//! Server traits and types for Links Queue TCP server.
//!
//! This module provides the core traits and configuration types for the
//! TCP server implementation.

use std::fmt::Debug;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::{BackendConfig, LinkType};

use super::connection::{Connection, ConnectionInfo};

// =============================================================================
// Server Configuration
// =============================================================================

/// Configuration for the Links Queue TCP server.
///
/// # Examples
///
/// ```rust
/// use links_queue::server::ServerConfig;
/// use links_queue::BackendConfig;
/// use std::time::Duration;
///
/// let config = ServerConfig::new("0.0.0.0".to_string(), 5000)
///     .with_backend(BackendConfig::memory())
///     .with_max_connections(1000)
///     .with_idle_timeout(Duration::from_secs(60));
/// ```
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Host address to bind to.
    pub host: String,

    /// Port to listen on.
    pub port: u16,

    /// Backend configuration for queue storage.
    pub backend: BackendConfig,

    /// Maximum number of concurrent connections.
    /// Defaults to 1000.
    pub max_connections: usize,

    /// Idle timeout for connections.
    /// Connections inactive for this duration will be closed.
    /// Defaults to 60 seconds.
    pub idle_timeout: Duration,

    /// Read timeout for socket operations.
    /// Defaults to 30 seconds.
    pub read_timeout: Duration,

    /// Write timeout for socket operations.
    /// Defaults to 30 seconds.
    pub write_timeout: Duration,

    /// Heartbeat interval for connection health checks.
    /// Defaults to 15 seconds.
    pub heartbeat_interval: Duration,

    /// Whether to enable TCP keepalive.
    /// Defaults to true.
    pub tcp_keepalive: bool,

    /// Whether to enable TCP nodelay (disable Nagle's algorithm).
    /// Defaults to true for lower latency.
    pub tcp_nodelay: bool,

    /// Buffer size for read/write operations.
    /// Defaults to 8KB.
    pub buffer_size: usize,

    /// Graceful shutdown timeout.
    /// Defaults to 30 seconds.
    pub shutdown_timeout: Duration,
}

impl ServerConfig {
    /// Creates a new server configuration with the given host and port.
    #[inline]
    #[must_use]
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            backend: BackendConfig::memory(),
            max_connections: 1000,
            idle_timeout: Duration::from_secs(60),
            read_timeout: Duration::from_secs(30),
            write_timeout: Duration::from_secs(30),
            heartbeat_interval: Duration::from_secs(15),
            tcp_keepalive: true,
            tcp_nodelay: true,
            buffer_size: 8192,
            shutdown_timeout: Duration::from_secs(30),
        }
    }

    /// Creates a server configuration for localhost on the given port.
    #[inline]
    #[must_use]
    pub fn localhost(port: u16) -> Self {
        Self::new("127.0.0.1".to_string(), port)
    }

    /// Sets the backend configuration.
    #[inline]
    #[must_use]
    pub fn with_backend(mut self, backend: BackendConfig) -> Self {
        self.backend = backend;
        self
    }

    /// Sets the maximum number of connections.
    #[inline]
    #[must_use]
    pub const fn with_max_connections(mut self, max_connections: usize) -> Self {
        self.max_connections = max_connections;
        self
    }

    /// Sets the idle timeout.
    #[inline]
    #[must_use]
    pub const fn with_idle_timeout(mut self, timeout: Duration) -> Self {
        self.idle_timeout = timeout;
        self
    }

    /// Sets the read timeout.
    #[inline]
    #[must_use]
    pub const fn with_read_timeout(mut self, timeout: Duration) -> Self {
        self.read_timeout = timeout;
        self
    }

    /// Sets the write timeout.
    #[inline]
    #[must_use]
    pub const fn with_write_timeout(mut self, timeout: Duration) -> Self {
        self.write_timeout = timeout;
        self
    }

    /// Sets the heartbeat interval.
    #[inline]
    #[must_use]
    pub const fn with_heartbeat_interval(mut self, interval: Duration) -> Self {
        self.heartbeat_interval = interval;
        self
    }

    /// Sets whether to enable TCP keepalive.
    #[inline]
    #[must_use]
    pub const fn with_tcp_keepalive(mut self, enabled: bool) -> Self {
        self.tcp_keepalive = enabled;
        self
    }

    /// Sets whether to enable TCP nodelay.
    #[inline]
    #[must_use]
    pub const fn with_tcp_nodelay(mut self, enabled: bool) -> Self {
        self.tcp_nodelay = enabled;
        self
    }

    /// Sets the buffer size.
    #[inline]
    #[must_use]
    pub const fn with_buffer_size(mut self, size: usize) -> Self {
        self.buffer_size = size;
        self
    }

    /// Sets the graceful shutdown timeout.
    #[inline]
    #[must_use]
    pub const fn with_shutdown_timeout(mut self, timeout: Duration) -> Self {
        self.shutdown_timeout = timeout;
        self
    }

    /// Returns the bind address in "host:port" format.
    #[must_use]
    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self::new("0.0.0.0".to_string(), 5000)
    }
}

// =============================================================================
// Server Error Types
// =============================================================================

/// Error codes for server operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ServerErrorCode {
    /// Failed to bind to the specified address.
    BindFailed,
    /// Server is already running.
    AlreadyRunning,
    /// Server is not running.
    NotRunning,
    /// Connection limit reached.
    ConnectionLimitReached,
    /// Connection error.
    ConnectionError,
    /// Protocol error (invalid message format).
    ProtocolError,
    /// Backend error (queue operation failed).
    BackendError,
    /// Shutdown timeout exceeded.
    ShutdownTimeout,
    /// I/O error.
    IoError,
}

impl std::fmt::Display for ServerErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BindFailed => write!(f, "BIND_FAILED"),
            Self::AlreadyRunning => write!(f, "ALREADY_RUNNING"),
            Self::NotRunning => write!(f, "NOT_RUNNING"),
            Self::ConnectionLimitReached => write!(f, "CONNECTION_LIMIT_REACHED"),
            Self::ConnectionError => write!(f, "CONNECTION_ERROR"),
            Self::ProtocolError => write!(f, "PROTOCOL_ERROR"),
            Self::BackendError => write!(f, "BACKEND_ERROR"),
            Self::ShutdownTimeout => write!(f, "SHUTDOWN_TIMEOUT"),
            Self::IoError => write!(f, "IO_ERROR"),
        }
    }
}

/// Error returned by server operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerError {
    /// The error code identifying the type of error.
    pub code: ServerErrorCode,
    /// Human-readable error message.
    pub message: String,
}

impl ServerError {
    /// Creates a new `ServerError`.
    #[inline]
    pub fn new(code: ServerErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Creates a "bind failed" error.
    #[inline]
    #[must_use]
    pub fn bind_failed(address: &str, reason: &str) -> Self {
        Self::new(
            ServerErrorCode::BindFailed,
            format!("Failed to bind to {address}: {reason}"),
        )
    }

    /// Creates an "already running" error.
    #[inline]
    #[must_use]
    pub fn already_running() -> Self {
        Self::new(ServerErrorCode::AlreadyRunning, "Server is already running")
    }

    /// Creates a "not running" error.
    #[inline]
    #[must_use]
    pub fn not_running() -> Self {
        Self::new(ServerErrorCode::NotRunning, "Server is not running")
    }

    /// Creates a "connection limit reached" error.
    #[inline]
    #[must_use]
    pub fn connection_limit_reached(limit: usize) -> Self {
        Self::new(
            ServerErrorCode::ConnectionLimitReached,
            format!("Connection limit of {limit} reached"),
        )
    }

    /// Creates a "connection error".
    #[inline]
    #[must_use]
    pub fn connection_error(details: &str) -> Self {
        Self::new(
            ServerErrorCode::ConnectionError,
            format!("Connection error: {details}"),
        )
    }

    /// Creates a "protocol error".
    #[inline]
    #[must_use]
    pub fn protocol_error(details: &str) -> Self {
        Self::new(
            ServerErrorCode::ProtocolError,
            format!("Protocol error: {details}"),
        )
    }

    /// Creates a "backend error".
    #[inline]
    #[must_use]
    pub fn backend_error(details: &str) -> Self {
        Self::new(
            ServerErrorCode::BackendError,
            format!("Backend error: {details}"),
        )
    }

    /// Creates a "shutdown timeout" error.
    #[inline]
    #[must_use]
    pub fn shutdown_timeout() -> Self {
        Self::new(
            ServerErrorCode::ShutdownTimeout,
            "Graceful shutdown timed out",
        )
    }

    /// Creates an "I/O error".
    #[inline]
    #[must_use]
    pub fn io_error(details: &str) -> Self {
        Self::new(
            ServerErrorCode::IoError,
            format!("I/O error: {details}"),
        )
    }
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ServerError {}

impl From<std::io::Error> for ServerError {
    fn from(err: std::io::Error) -> Self {
        Self::io_error(&err.to_string())
    }
}

/// Result type for server operations.
pub type ServerResult<T> = Result<T, ServerError>;

// =============================================================================
// Server Events
// =============================================================================

/// Events emitted by the server.
#[derive(Debug, Clone)]
pub enum ServerEvent {
    /// Server has started listening.
    Started {
        /// The address the server is bound to.
        address: String,
    },
    /// A client has connected.
    ClientConnected {
        /// Information about the connection.
        info: ConnectionInfo,
    },
    /// A client has disconnected.
    ClientDisconnected {
        /// Connection ID of the disconnected client.
        connection_id: String,
        /// Reason for disconnection.
        reason: String,
    },
    /// Server is shutting down.
    ShuttingDown {
        /// Number of active connections being drained.
        active_connections: usize,
    },
    /// Server has stopped.
    Stopped,
    /// An error occurred.
    Error {
        /// The error that occurred.
        error: ServerError,
    },
}

// =============================================================================
// Server Statistics
// =============================================================================

/// Statistics about the server's current state.
#[derive(Debug, Clone, Default)]
pub struct ServerStats {
    /// Whether the server is currently running.
    pub is_running: bool,

    /// Number of current active connections.
    pub active_connections: usize,

    /// Total number of connections accepted since start.
    pub total_connections: u64,

    /// Total number of requests processed since start.
    pub total_requests: u64,

    /// Number of requests that resulted in errors.
    pub error_count: u64,

    /// Unix timestamp (milliseconds) when the server started.
    pub started_at: u64,

    /// Current bytes read per second.
    pub bytes_read_per_sec: f64,

    /// Current bytes written per second.
    pub bytes_written_per_sec: f64,

    /// Average request latency in milliseconds.
    pub avg_request_latency_ms: f64,
}

impl ServerStats {
    /// Creates a new `ServerStats` with default values.
    #[inline]
    #[must_use]
    pub const fn new() -> Self {
        Self {
            is_running: false,
            active_connections: 0,
            total_connections: 0,
            total_requests: 0,
            error_count: 0,
            started_at: 0,
            bytes_read_per_sec: 0.0,
            bytes_written_per_sec: 0.0,
            avg_request_latency_ms: 0.0,
        }
    }
}

// =============================================================================
// Connection Event Handler Types
// =============================================================================

/// Type alias for connection event handler.
#[allow(dead_code)]
pub type ConnectionHandler<T> = Arc<dyn Fn(&Connection<T>) + Send + Sync>;

// =============================================================================
// LinksQueueServer Trait
// =============================================================================

/// Trait for the Links Queue TCP server.
///
/// The server accepts client connections and routes requests to the
/// appropriate queue operations. It manages connection lifecycle,
/// implements the protocol, and handles graceful shutdown.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Examples
///
/// ```rust,ignore
/// use links_queue::server::{LinksQueueServer, ServerConfig};
///
/// async fn run_server<T, S>(server: &S) -> Result<(), Box<dyn std::error::Error>>
/// where
///     T: LinkType,
///     S: LinksQueueServer<T>,
/// {
///     // Start the server
///     server.start().await?;
///     println!("Server listening on {}", server.config().bind_address());
///
///     // Get statistics
///     let stats = server.stats();
///     println!("Active connections: {}", stats.active_connections);
///
///     // Graceful shutdown
///     server.shutdown(Duration::from_secs(30)).await?;
///     Ok(())
/// }
/// ```
pub trait LinksQueueServer<T: LinkType>: Send + Sync {
    /// Returns the server configuration.
    fn config(&self) -> &ServerConfig;

    /// Starts the server and begins accepting connections.
    ///
    /// This method returns immediately after the server starts listening.
    /// The server runs in the background until `shutdown()` is called.
    ///
    /// # Errors
    ///
    /// Returns an error if the server is already running or if binding fails.
    fn start(&self) -> impl Future<Output = ServerResult<()>> + Send;

    /// Stops the server with graceful shutdown.
    ///
    /// During shutdown:
    /// 1. Stop accepting new connections
    /// 2. Wait for in-flight requests to complete
    /// 3. Close all connections
    ///
    /// # Arguments
    ///
    /// * `timeout` - Maximum time to wait for graceful shutdown
    ///
    /// # Errors
    ///
    /// Returns `ShutdownTimeout` if the timeout is exceeded.
    fn shutdown(&self, timeout: Duration) -> impl Future<Output = ServerResult<()>> + Send;

    /// Returns whether the server is currently running.
    fn is_running(&self) -> bool;

    /// Returns the current server statistics.
    fn stats(&self) -> ServerStats;

    /// Registers a callback for when a client connects.
    ///
    /// # Arguments
    ///
    /// * `handler` - Callback function receiving the connection
    fn on_connection(&self, handler: impl Fn(&Connection<T>) + Send + Sync + 'static);

    /// Returns the list of currently active connections.
    fn get_connections(&self) -> Vec<ConnectionInfo>;

    /// Forcefully closes a specific connection.
    ///
    /// # Arguments
    ///
    /// * `connection_id` - ID of the connection to close
    ///
    /// # Returns
    ///
    /// `true` if the connection was found and closed, `false` otherwise.
    fn close_connection(&self, connection_id: &str) -> bool;
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod server_config_tests {
        use super::*;

        #[test]
        fn test_server_config_new() {
            let config = ServerConfig::new("0.0.0.0".to_string(), 5000);
            assert_eq!(config.host, "0.0.0.0");
            assert_eq!(config.port, 5000);
            assert_eq!(config.max_connections, 1000);
        }

        #[test]
        fn test_server_config_localhost() {
            let config = ServerConfig::localhost(8080);
            assert_eq!(config.host, "127.0.0.1");
            assert_eq!(config.port, 8080);
        }

        #[test]
        fn test_server_config_bind_address() {
            let config = ServerConfig::new("192.168.1.1".to_string(), 3000);
            assert_eq!(config.bind_address(), "192.168.1.1:3000");
        }

        #[test]
        fn test_server_config_builder() {
            let config = ServerConfig::new("0.0.0.0".to_string(), 5000)
                .with_max_connections(500)
                .with_idle_timeout(Duration::from_secs(120))
                .with_tcp_nodelay(false);

            assert_eq!(config.max_connections, 500);
            assert_eq!(config.idle_timeout, Duration::from_secs(120));
            assert!(!config.tcp_nodelay);
        }

        #[test]
        fn test_server_config_default() {
            let config = ServerConfig::default();
            assert_eq!(config.host, "0.0.0.0");
            assert_eq!(config.port, 5000);
        }
    }

    mod server_error_tests {
        use super::*;

        #[test]
        fn test_server_error_code_display() {
            assert_eq!(format!("{}", ServerErrorCode::BindFailed), "BIND_FAILED");
            assert_eq!(
                format!("{}", ServerErrorCode::AlreadyRunning),
                "ALREADY_RUNNING"
            );
            assert_eq!(format!("{}", ServerErrorCode::NotRunning), "NOT_RUNNING");
            assert_eq!(
                format!("{}", ServerErrorCode::ConnectionLimitReached),
                "CONNECTION_LIMIT_REACHED"
            );
        }

        #[test]
        fn test_server_error_factories() {
            let err = ServerError::bind_failed("0.0.0.0:5000", "address in use");
            assert_eq!(err.code, ServerErrorCode::BindFailed);
            assert!(err.message.contains("0.0.0.0:5000"));

            let err = ServerError::already_running();
            assert_eq!(err.code, ServerErrorCode::AlreadyRunning);

            let err = ServerError::connection_limit_reached(1000);
            assert_eq!(err.code, ServerErrorCode::ConnectionLimitReached);
            assert!(err.message.contains("1000"));

            let err = ServerError::protocol_error("invalid frame");
            assert_eq!(err.code, ServerErrorCode::ProtocolError);
            assert!(err.message.contains("invalid frame"));
        }

        #[test]
        fn test_server_error_display() {
            let err = ServerError::bind_failed("0.0.0.0:5000", "port in use");
            let display = format!("{err}");
            assert!(display.contains("BIND_FAILED"));
            assert!(display.contains("0.0.0.0:5000"));
        }
    }

    mod server_stats_tests {
        use super::*;

        #[test]
        fn test_server_stats_default() {
            let stats = ServerStats::default();
            assert!(!stats.is_running);
            assert_eq!(stats.active_connections, 0);
            assert_eq!(stats.total_connections, 0);
            assert_eq!(stats.total_requests, 0);
        }

        #[test]
        fn test_server_stats_new() {
            let stats = ServerStats::new();
            assert!(!stats.is_running);
            assert_eq!(stats.error_count, 0);
        }
    }
}
