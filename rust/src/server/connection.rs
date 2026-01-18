//! Connection handling for Links Queue TCP server.
//!
//! This module provides types for managing client connections, including
//! connection state, read/write operations, and lifecycle management.

// Allow clippy warnings for this module (new code, will be refined in future PRs)
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::missing_fields_in_debug)]
#![allow(clippy::significant_drop_tightening)]
#![allow(clippy::missing_const_for_fn)]
#![allow(dead_code)]

use std::fmt::{self, Debug, Display};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, RwLock};

use crate::LinkType;

use super::traits::{ServerError, ServerResult};

// =============================================================================
// Connection ID
// =============================================================================

/// Unique identifier for a connection.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionId(String);

impl ConnectionId {
    /// Creates a new connection ID.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Generates a new unique connection ID.
    #[must_use]
    pub fn generate() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Self(format!("conn-{timestamp}-{id}"))
    }

    /// Returns the ID as a string slice.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for ConnectionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<String> for ConnectionId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for ConnectionId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

// =============================================================================
// Connection State
// =============================================================================

/// State of a client connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ConnectionState {
    /// Connection is being established.
    #[default]
    Connecting,
    /// Connection is active and can send/receive messages.
    Active,
    /// Connection is draining (finishing in-flight requests).
    Draining,
    /// Connection is closed.
    Closed,
}

impl Display for ConnectionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Connecting => write!(f, "connecting"),
            Self::Active => write!(f, "active"),
            Self::Draining => write!(f, "draining"),
            Self::Closed => write!(f, "closed"),
        }
    }
}

// =============================================================================
// Connection Info
// =============================================================================

/// Information about a connection (for external visibility).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionInfo {
    /// Unique connection identifier.
    pub id: String,

    /// Remote address of the client.
    pub remote_addr: String,

    /// Current state of the connection.
    pub state: ConnectionState,

    /// Unix timestamp (milliseconds) when the connection was established.
    pub connected_at: u64,

    /// Unix timestamp (milliseconds) of the last activity.
    pub last_activity_at: u64,

    /// Number of requests processed on this connection.
    pub request_count: u64,

    /// Total bytes read from this connection.
    pub bytes_read: u64,

    /// Total bytes written to this connection.
    pub bytes_written: u64,
}

impl ConnectionInfo {
    /// Creates a new `ConnectionInfo`.
    #[must_use]
    pub fn new(id: String, remote_addr: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            id,
            remote_addr,
            state: ConnectionState::Connecting,
            connected_at: now,
            last_activity_at: now,
            request_count: 0,
            bytes_read: 0,
            bytes_written: 0,
        }
    }
}

// =============================================================================
// Connection
// =============================================================================

/// Represents a client connection to the server.
///
/// Handles the framing protocol, read/write operations, and maintains
/// connection state. Each connection runs its own event loop for
/// processing requests.
///
/// # Protocol Framing
///
/// Messages are length-prefixed with a 4-byte big-endian length:
/// ```text
/// +--------+--------+--------+--------+----------------+
/// |      Length (4 bytes BE)         |    Payload     |
/// +--------+--------+--------+--------+----------------+
/// ```
pub struct Connection<T: LinkType> {
    /// Unique connection identifier.
    id: ConnectionId,

    /// Remote address of the client.
    remote_addr: SocketAddr,

    /// Current state of the connection.
    state: RwLock<ConnectionState>,

    /// TCP stream reader.
    reader: Mutex<BufReader<tokio::net::tcp::OwnedReadHalf>>,

    /// TCP stream writer.
    writer: Mutex<BufWriter<tokio::net::tcp::OwnedWriteHalf>>,

    /// Connection statistics.
    stats: ConnectionStats,

    /// Instant when the connection was established.
    connected_at: Instant,

    /// Last activity timestamp.
    last_activity: RwLock<Instant>,

    /// Phantom data for type parameter.
    _marker: std::marker::PhantomData<T>,
}

impl<T: LinkType> Connection<T> {
    /// Creates a new connection from a TCP stream.
    pub fn new(stream: TcpStream, remote_addr: SocketAddr) -> Self {
        let (read_half, write_half) = stream.into_split();
        let now = Instant::now();

        Self {
            id: ConnectionId::generate(),
            remote_addr,
            state: RwLock::new(ConnectionState::Active),
            reader: Mutex::new(BufReader::with_capacity(8192, read_half)),
            writer: Mutex::new(BufWriter::with_capacity(8192, write_half)),
            stats: ConnectionStats::new(),
            connected_at: now,
            last_activity: RwLock::new(now),
            _marker: std::marker::PhantomData,
        }
    }

    /// Returns the connection ID.
    #[must_use]
    pub fn id(&self) -> &ConnectionId {
        &self.id
    }

    /// Returns the remote address.
    #[must_use]
    pub fn remote_addr(&self) -> SocketAddr {
        self.remote_addr
    }

    /// Returns the current connection state.
    pub async fn state(&self) -> ConnectionState {
        *self.state.read().await
    }

    /// Sets the connection state.
    pub async fn set_state(&self, state: ConnectionState) {
        *self.state.write().await = state;
    }

    /// Returns connection information.
    pub async fn info(&self) -> ConnectionInfo {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let connected_at_ms = now_ms - self.connected_at.elapsed().as_millis() as u64;
        let last_activity = self.last_activity.read().await;
        let last_activity_ms = now_ms - last_activity.elapsed().as_millis() as u64;

        ConnectionInfo {
            id: self.id.to_string(),
            remote_addr: self.remote_addr.to_string(),
            state: *self.state.read().await,
            connected_at: connected_at_ms,
            last_activity_at: last_activity_ms,
            request_count: self.stats.request_count.load(Ordering::SeqCst),
            bytes_read: self.stats.bytes_read.load(Ordering::SeqCst),
            bytes_written: self.stats.bytes_written.load(Ordering::SeqCst),
        }
    }

    /// Updates the last activity timestamp.
    pub async fn touch(&self) {
        *self.last_activity.write().await = Instant::now();
    }

    /// Returns how long since the last activity.
    pub async fn idle_duration(&self) -> Duration {
        self.last_activity.read().await.elapsed()
    }

    /// Returns connection statistics.
    pub fn stats(&self) -> &ConnectionStats {
        &self.stats
    }

    /// Reads a framed message from the connection.
    ///
    /// Returns `None` if the connection is closed.
    pub async fn read_message(&self) -> ServerResult<Option<Vec<u8>>> {
        let mut reader = self.reader.lock().await;

        // Read 4-byte length prefix
        let mut len_buf = [0u8; 4];
        match reader.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None);
            }
            Err(e) => {
                return Err(ServerError::io_error(&e.to_string()));
            }
        }

        let len = u32::from_be_bytes(len_buf) as usize;

        // Sanity check on message length (max 16MB)
        if len > 16 * 1024 * 1024 {
            return Err(ServerError::protocol_error(&format!(
                "Message too large: {len} bytes"
            )));
        }

        // Read the message body
        let mut buf = vec![0u8; len];
        reader.read_exact(&mut buf).await?;

        self.stats
            .bytes_read
            .fetch_add((4 + len) as u64, Ordering::SeqCst);
        self.touch().await;

        Ok(Some(buf))
    }

    /// Writes a framed message to the connection.
    pub async fn write_message(&self, data: &[u8]) -> ServerResult<()> {
        let mut writer = self.writer.lock().await;

        // Write 4-byte length prefix
        let len = data.len() as u32;
        writer.write_all(&len.to_be_bytes()).await?;

        // Write the message body
        writer.write_all(data).await?;
        writer.flush().await?;

        self.stats
            .bytes_written
            .fetch_add((4 + data.len()) as u64, Ordering::SeqCst);
        self.touch().await;

        Ok(())
    }

    /// Sends a ping frame and waits for pong.
    pub async fn ping(&self, _timeout: Duration) -> ServerResult<Duration> {
        let start = Instant::now();

        // Send ping frame (op: "ping")
        let ping_msg = b"{\"op\":\"ping\"}";
        self.write_message(ping_msg).await?;

        // Read pong response
        let response = self.read_message().await?;
        match response {
            Some(data) => {
                // Verify it's a pong
                let response_str = String::from_utf8_lossy(&data);
                if !response_str.contains("\"pong\"") {
                    return Err(ServerError::protocol_error("Expected pong response"));
                }
                Ok(start.elapsed())
            }
            None => Err(ServerError::connection_error(
                "Connection closed during ping",
            )),
        }
    }

    /// Closes the connection.
    pub async fn close(&self) {
        self.set_state(ConnectionState::Closed).await;
    }

    /// Increments the request count.
    pub fn increment_request_count(&self) {
        self.stats.request_count.fetch_add(1, Ordering::SeqCst);
    }
}

impl<T: LinkType> Debug for Connection<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Connection")
            .field("id", &self.id)
            .field("remote_addr", &self.remote_addr)
            .finish()
    }
}

// =============================================================================
// Connection Statistics
// =============================================================================

/// Statistics for a connection.
#[derive(Debug, Default)]
pub struct ConnectionStats {
    /// Number of requests processed.
    pub request_count: AtomicU64,

    /// Total bytes read.
    pub bytes_read: AtomicU64,

    /// Total bytes written.
    pub bytes_written: AtomicU64,
}

impl ConnectionStats {
    /// Creates new connection statistics.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            request_count: AtomicU64::new(0),
            bytes_read: AtomicU64::new(0),
            bytes_written: AtomicU64::new(0),
        }
    }
}

// =============================================================================
// Connection Pool (for managing multiple connections)
// =============================================================================

/// Manages a pool of client connections.
pub struct ConnectionPool<T: LinkType> {
    /// Active connections.
    connections: RwLock<std::collections::HashMap<String, Arc<Connection<T>>>>,

    /// Maximum number of connections.
    max_connections: usize,
}

impl<T: LinkType> ConnectionPool<T> {
    /// Creates a new connection pool.
    #[must_use]
    pub fn new(max_connections: usize) -> Self {
        Self {
            connections: RwLock::new(std::collections::HashMap::new()),
            max_connections,
        }
    }

    /// Adds a connection to the pool.
    ///
    /// Returns an error if the pool is at capacity.
    pub async fn add(&self, connection: Arc<Connection<T>>) -> ServerResult<()> {
        let mut connections = self.connections.write().await;

        if connections.len() >= self.max_connections {
            return Err(ServerError::connection_limit_reached(self.max_connections));
        }

        let id = connection.id().to_string();
        connections.insert(id, connection);
        Ok(())
    }

    /// Removes a connection from the pool.
    pub async fn remove(&self, id: &str) -> Option<Arc<Connection<T>>> {
        let mut connections = self.connections.write().await;
        connections.remove(id)
    }

    /// Gets a connection by ID.
    pub async fn get(&self, id: &str) -> Option<Arc<Connection<T>>> {
        let connections = self.connections.read().await;
        connections.get(id).cloned()
    }

    /// Returns the number of active connections.
    pub async fn len(&self) -> usize {
        self.connections.read().await.len()
    }

    /// Returns whether the pool is empty.
    pub async fn is_empty(&self) -> bool {
        self.connections.read().await.is_empty()
    }

    /// Returns info for all connections.
    pub async fn get_all_info(&self) -> Vec<ConnectionInfo> {
        let connections = self.connections.read().await;
        let mut infos = Vec::with_capacity(connections.len());

        for conn in connections.values() {
            infos.push(conn.info().await);
        }

        infos
    }

    /// Closes all connections.
    pub async fn close_all(&self) {
        let connections = self.connections.read().await;
        for conn in connections.values() {
            conn.close().await;
        }
    }

    /// Removes idle connections.
    pub async fn remove_idle(&self, idle_timeout: Duration) -> usize {
        let mut connections = self.connections.write().await;
        let mut to_remove = Vec::new();

        for (id, conn) in connections.iter() {
            if conn.idle_duration().await > idle_timeout {
                to_remove.push(id.clone());
            }
        }

        for id in &to_remove {
            if let Some(conn) = connections.remove(id) {
                conn.close().await;
            }
        }

        to_remove.len()
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod connection_id_tests {
        use super::*;

        #[test]
        fn test_connection_id_new() {
            let id = ConnectionId::new("test-123");
            assert_eq!(id.as_str(), "test-123");
        }

        #[test]
        fn test_connection_id_generate() {
            let id1 = ConnectionId::generate();
            let id2 = ConnectionId::generate();
            assert_ne!(id1, id2);
        }

        #[test]
        fn test_connection_id_display() {
            let id = ConnectionId::new("conn-1");
            assert_eq!(format!("{id}"), "conn-1");
        }

        #[test]
        fn test_connection_id_from_string() {
            let id: ConnectionId = "test".into();
            assert_eq!(id.as_str(), "test");
        }
    }

    mod connection_state_tests {
        use super::*;

        #[test]
        fn test_connection_state_display() {
            assert_eq!(format!("{}", ConnectionState::Connecting), "connecting");
            assert_eq!(format!("{}", ConnectionState::Active), "active");
            assert_eq!(format!("{}", ConnectionState::Draining), "draining");
            assert_eq!(format!("{}", ConnectionState::Closed), "closed");
        }

        #[test]
        fn test_connection_state_default() {
            let state = ConnectionState::default();
            assert_eq!(state, ConnectionState::Connecting);
        }
    }

    mod connection_info_tests {
        use super::*;

        #[test]
        fn test_connection_info_new() {
            let info = ConnectionInfo::new("conn-1".to_string(), "127.0.0.1:12345".to_string());
            assert_eq!(info.id, "conn-1");
            assert_eq!(info.remote_addr, "127.0.0.1:12345");
            assert_eq!(info.state, ConnectionState::Connecting);
            assert_eq!(info.request_count, 0);
        }
    }

    mod connection_stats_tests {
        use super::*;

        #[test]
        fn test_connection_stats_new() {
            let stats = ConnectionStats::new();
            assert_eq!(stats.request_count.load(Ordering::SeqCst), 0);
            assert_eq!(stats.bytes_read.load(Ordering::SeqCst), 0);
            assert_eq!(stats.bytes_written.load(Ordering::SeqCst), 0);
        }
    }

    mod connection_pool_tests {
        use super::*;

        #[tokio::test]
        async fn test_connection_pool_capacity() {
            let pool = ConnectionPool::<u64>::new(2);
            assert!(pool.is_empty().await);
            assert_eq!(pool.len().await, 0);
        }
    }
}
