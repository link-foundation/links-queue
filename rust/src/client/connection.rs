//! Client connection handling for Links Queue TCP client.
//!
//! This module provides the connection management for the client,
//! including connect, disconnect, request/response handling, and reconnection.

use std::fmt::{self, Debug, Display};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, RwLock};
use tokio::time::timeout;

use crate::{Link, LinkRef, LinkType, QueueOptions, QueueStats};

use super::traits::{
    ClientConfig, ClientError, ClientResult, EnqueueResult, LinksQueueClient, QueueInfo,
    Subscription,
};

// =============================================================================
// Connection State
// =============================================================================

/// State of the client connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum ConnectionState {
    /// Not connected.
    #[default]
    Disconnected,
    /// Connecting to the server.
    Connecting,
    /// Connected and ready.
    Connected,
    /// Reconnecting after connection loss.
    Reconnecting,
}

impl Display for ConnectionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disconnected => write!(f, "disconnected"),
            Self::Connecting => write!(f, "connecting"),
            Self::Connected => write!(f, "connected"),
            Self::Reconnecting => write!(f, "reconnecting"),
        }
    }
}

// =============================================================================
// Client Connection
// =============================================================================

/// TCP connection for the Links Queue client.
///
/// Handles the low-level protocol, message framing, and connection lifecycle.
pub struct ClientConnection<T: LinkType> {
    /// Client configuration.
    config: ClientConfig,

    /// Server address.
    address: RwLock<Option<String>>,

    /// Connection state.
    state: RwLock<ConnectionState>,

    /// TCP stream reader.
    reader: Mutex<Option<BufReader<tokio::net::tcp::OwnedReadHalf>>>,

    /// TCP stream writer.
    writer: Mutex<Option<BufWriter<tokio::net::tcp::OwnedWriteHalf>>>,

    /// Request counter for stats.
    request_count: AtomicU64,

    /// Phantom data for type parameter.
    _marker: std::marker::PhantomData<T>,
}

impl<T: LinkType + FromStr + Display> ClientConnection<T>
where
    <T as FromStr>::Err: Debug,
{
    /// Creates a new client connection.
    fn new(config: ClientConfig) -> Self {
        Self {
            config,
            address: RwLock::new(None),
            state: RwLock::new(ConnectionState::Disconnected),
            reader: Mutex::new(None),
            writer: Mutex::new(None),
            request_count: AtomicU64::new(0),
            _marker: std::marker::PhantomData,
        }
    }

    /// Connects to the server.
    async fn connect_internal(&self, address: &str) -> ClientResult<()> {
        // Parse address
        let addr = parse_address(address)?;

        // Set state to connecting
        *self.state.write().await = ConnectionState::Connecting;

        // Connect with timeout
        let stream = match timeout(self.config.connect_timeout, TcpStream::connect(&addr)).await {
            Ok(Ok(stream)) => stream,
            Ok(Err(e)) => {
                *self.state.write().await = ConnectionState::Disconnected;
                return Err(ClientError::connection_failed(address, &e.to_string()));
            }
            Err(_) => {
                *self.state.write().await = ConnectionState::Disconnected;
                return Err(ClientError::timeout("connect"));
            }
        };

        // Configure socket
        if self.config.tcp_nodelay {
            let _ = stream.set_nodelay(true);
        }

        // Split the stream
        let (read_half, write_half) = stream.into_split();

        *self.reader.lock().await =
            Some(BufReader::with_capacity(self.config.buffer_size, read_half));
        *self.writer.lock().await = Some(BufWriter::with_capacity(
            self.config.buffer_size,
            write_half,
        ));
        *self.address.write().await = Some(address.to_string());
        *self.state.write().await = ConnectionState::Connected;

        Ok(())
    }

    /// Disconnects from the server.
    async fn disconnect_internal(&self) -> ClientResult<()> {
        let state = *self.state.read().await;
        if state == ConnectionState::Disconnected {
            return Ok(());
        }

        *self.reader.lock().await = None;
        *self.writer.lock().await = None;
        *self.state.write().await = ConnectionState::Disconnected;

        Ok(())
    }

    /// Sends a request and receives a response.
    async fn request(&self, request_json: &str) -> ClientResult<ResponseData> {
        let state = *self.state.read().await;
        if state != ConnectionState::Connected {
            return Err(ClientError::not_connected());
        }

        // Send request
        self.write_message(request_json.as_bytes()).await?;

        // Read response
        let response = self.read_message().await?;

        // Parse response
        parse_response(&response)
    }

    /// Writes a framed message.
    async fn write_message(&self, data: &[u8]) -> ClientResult<()> {
        let mut writer_guard = self.writer.lock().await;
        let writer = writer_guard
            .as_mut()
            .ok_or_else(ClientError::not_connected)?;

        // Write length prefix
        let len = data.len() as u32;
        writer.write_all(&len.to_be_bytes()).await?;

        // Write data
        writer.write_all(data).await?;
        writer.flush().await?;

        self.request_count.fetch_add(1, Ordering::SeqCst);

        Ok(())
    }

    /// Reads a framed message.
    async fn read_message(&self) -> ClientResult<Vec<u8>> {
        let mut reader_guard = self.reader.lock().await;
        let reader = reader_guard
            .as_mut()
            .ok_or_else(ClientError::not_connected)?;

        // Read length prefix
        let mut len_buf = [0u8; 4];
        reader.read_exact(&mut len_buf).await?;
        let len = u32::from_be_bytes(len_buf) as usize;

        // Sanity check
        if len > 16 * 1024 * 1024 {
            return Err(ClientError::protocol_error(&format!(
                "Message too large: {len} bytes"
            )));
        }

        // Read data
        let mut buf = vec![0u8; len];
        reader.read_exact(&mut buf).await?;

        Ok(buf)
    }
}

impl<T: LinkType + FromStr + Display> LinksQueueClient<T> for ClientConnection<T>
where
    <T as FromStr>::Err: Debug,
{
    fn config(&self) -> &ClientConfig {
        &self.config
    }

    fn is_connected(&self) -> bool {
        // Use try_read to avoid blocking
        self.state
            .try_read()
            .map(|s| *s == ConnectionState::Connected)
            .unwrap_or(false)
    }

    fn server_address(&self) -> Option<String> {
        self.address.try_read().ok().and_then(|a| a.clone())
    }

    async fn connect(address: &str) -> ClientResult<Self> {
        let connection = Self::new(ClientConfig::default());
        connection.connect_internal(address).await?;
        Ok(connection)
    }

    async fn connect_with_config(address: &str, config: ClientConfig) -> ClientResult<Self> {
        let connection = Self::new(config);
        connection.connect_internal(address).await?;
        Ok(connection)
    }

    async fn disconnect(&self) -> ClientResult<()> {
        self.disconnect_internal().await
    }

    async fn ping(&self) -> ClientResult<Duration> {
        let start = Instant::now();
        let response = self.request(r#"{"op":"ping"}"#).await?;

        match response {
            ResponseData::Pong => Ok(start.elapsed()),
            _ => Err(ClientError::protocol_error("Expected pong response")),
        }
    }

    async fn create_queue(&self, name: &str, options: QueueOptions) -> ClientResult<()> {
        let mut request = format!(r#"{{"op":"create_queue","queue":"{name}""#);

        // Add options if any are set
        let mut opts_parts = Vec::new();
        if let Some(max_size) = options.max_size {
            opts_parts.push(format!(r#""max_size":{max_size}"#));
        }
        if let Some(visibility_timeout) = options.visibility_timeout {
            opts_parts.push(format!(r#""visibility_timeout":{visibility_timeout}"#));
        }
        if let Some(retry_limit) = options.retry_limit {
            opts_parts.push(format!(r#""retry_limit":{retry_limit}"#));
        }
        if let Some(ref dlq) = options.dead_letter_queue {
            opts_parts.push(format!(r#""dead_letter_queue":"{dlq}""#));
        }
        if let Some(priority) = options.priority {
            opts_parts.push(format!(r#""priority":{priority}"#));
        }

        if !opts_parts.is_empty() {
            request.push_str(r#","options":{"#);
            request.push_str(&opts_parts.join(","));
            request.push('}');
        }

        request.push('}');

        let response = self.request(&request).await?;
        match response {
            ResponseData::QueueInfo { .. } => Ok(()),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn delete_queue(&self, name: &str) -> ClientResult<bool> {
        let request = format!(r#"{{"op":"delete_queue","queue":"{name}"}}"#);
        let response = self.request(&request).await?;

        match response {
            ResponseData::Bool(deleted) => Ok(deleted),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn get_queue(&self, name: &str) -> ClientResult<Option<QueueInfo>> {
        let request = format!(r#"{{"op":"get_queue","queue":"{name}"}}"#);
        let response = self.request(&request).await?;

        match response {
            ResponseData::QueueInfo { name, depth } => Ok(Some(QueueInfo::new(name, depth))),
            ResponseData::Error { code, .. } if code == "QUEUE_NOT_FOUND" => Ok(None),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn list_queues(&self) -> ClientResult<Vec<String>> {
        let response = self.request(r#"{"op":"list_queues"}"#).await?;

        match response {
            ResponseData::QueueList(queues) => Ok(queues),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn enqueue(&self, queue: &str, link: Link<T>) -> ClientResult<EnqueueResult<T>> {
        let request = format!(
            r#"{{"op":"enqueue","queue":"{}","link":{{"id":{},"source":{},"target":{}}}}}"#,
            queue,
            format!("{:?}", link.id),
            format!("{:?}", link.source_id()),
            format!("{:?}", link.target_id())
        );

        let response = self.request(&request).await?;

        match response {
            ResponseData::EnqueueResult { id, position } => {
                let typed_id = id
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid ID in response"))?;
                Ok(EnqueueResult::new(typed_id, position))
            }
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn dequeue(&self, queue: &str) -> ClientResult<Option<Link<T>>> {
        let request = format!(r#"{{"op":"dequeue","queue":"{queue}"}}"#);
        let response = self.request(&request).await?;

        match response {
            ResponseData::Link { id, source, target } => {
                let typed_id = id
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid ID"))?;
                let typed_source = source
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid source"))?;
                let typed_target = target
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid target"))?;

                Ok(Some(Link::new(
                    typed_id,
                    LinkRef::Id(typed_source),
                    LinkRef::Id(typed_target),
                )))
            }
            ResponseData::Empty => Ok(None),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn peek(&self, queue: &str) -> ClientResult<Option<Link<T>>> {
        let request = format!(r#"{{"op":"peek","queue":"{queue}"}}"#);
        let response = self.request(&request).await?;

        match response {
            ResponseData::Link { id, source, target } => {
                let typed_id = id
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid ID"))?;
                let typed_source = source
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid source"))?;
                let typed_target = target
                    .to_string()
                    .parse::<T>()
                    .map_err(|_| ClientError::protocol_error("Invalid target"))?;

                Ok(Some(Link::new(
                    typed_id,
                    LinkRef::Id(typed_source),
                    LinkRef::Id(typed_target),
                )))
            }
            ResponseData::Empty => Ok(None),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn acknowledge(&self, queue: &str, id: T) -> ClientResult<()> {
        let request = format!(
            r#"{{"op":"acknowledge","queue":"{}","id":{}}}"#,
            queue,
            format!("{:?}", id)
        );

        let response = self.request(&request).await?;

        match response {
            ResponseData::Bool(true) => Ok(()),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn reject(&self, queue: &str, id: T, requeue: bool) -> ClientResult<()> {
        let request = format!(
            r#"{{"op":"reject","queue":"{}","id":{},"requeue":{}}}"#,
            queue,
            format!("{:?}", id),
            requeue
        );

        let response = self.request(&request).await?;

        match response {
            ResponseData::Bool(true) => Ok(()),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn stats(&self, queue: &str) -> ClientResult<QueueStats> {
        let request = format!(r#"{{"op":"stats","queue":"{queue}"}}"#);
        let response = self.request(&request).await?;

        match response {
            ResponseData::QueueStats {
                depth,
                enqueued,
                dequeued,
                acknowledged,
                rejected,
                in_flight,
            } => Ok(QueueStats {
                depth,
                enqueued,
                dequeued,
                acknowledged,
                rejected,
                in_flight,
            }),
            ResponseData::Error { message, code } => {
                Err(ClientError::server_error(&message, &code))
            }
            _ => Err(ClientError::protocol_error("Unexpected response")),
        }
    }

    async fn subscribe(&self, queue: &str) -> ClientResult<Subscription<T>> {
        // For now, just return a subscription object
        // Real implementation would set up the subscription with the server
        Ok(Subscription::new(queue.to_string()))
    }

    async fn unsubscribe(&self, _subscription: Subscription<T>) -> ClientResult<()> {
        // For now, just return Ok
        // Real implementation would notify the server
        Ok(())
    }
}

impl<T: LinkType> Debug for ClientConnection<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClientConnection")
            .field("config", &self.config)
            .finish()
    }
}

// =============================================================================
// Response Data
// =============================================================================

/// Parsed response data from the server.
#[derive(Debug, Clone)]
enum ResponseData {
    Pong,
    Link {
        id: u64,
        source: u64,
        target: u64,
    },
    QueueInfo {
        name: String,
        depth: usize,
    },
    QueueStats {
        depth: usize,
        enqueued: usize,
        dequeued: usize,
        acknowledged: usize,
        rejected: usize,
        in_flight: usize,
    },
    QueueList(Vec<String>),
    EnqueueResult {
        id: u64,
        position: usize,
    },
    Bool(bool),
    Empty,
    Error {
        message: String,
        code: String,
    },
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Parses a server address.
fn parse_address(address: &str) -> ClientResult<String> {
    // Remove tcp:// prefix if present
    let addr = address.strip_prefix("tcp://").unwrap_or(address);

    // Validate format (simple check)
    if !addr.contains(':') {
        return Err(ClientError::invalid_address(address));
    }

    Ok(addr.to_string())
}

/// Parses a response from JSON bytes.
fn parse_response(data: &[u8]) -> ClientResult<ResponseData> {
    let s = std::str::from_utf8(data)
        .map_err(|e| ClientError::protocol_error(&format!("Invalid UTF-8: {e}")))?;

    parse_response_json(s)
}

/// Parses a response from JSON string.
fn parse_response_json(json: &str) -> ClientResult<ResponseData> {
    // Check if ok
    let ok = json.contains(r#""ok":true"#);

    if !ok {
        // Parse error response
        let error =
            extract_json_string(json, "error").unwrap_or_else(|| "Unknown error".to_string());
        let code = extract_json_string(json, "code").unwrap_or_else(|| "UNKNOWN".to_string());
        return Ok(ResponseData::Error {
            message: error,
            code,
        });
    }

    // Check for pong
    if json.contains(r#""result":"pong""#) {
        return Ok(ResponseData::Pong);
    }

    // Check for bool result
    if json.contains(r#""result":true"#) {
        return Ok(ResponseData::Bool(true));
    }
    if json.contains(r#""result":false"#) {
        return Ok(ResponseData::Bool(false));
    }

    // Check for empty result
    if json == r#"{"ok":true}"# || json.contains(r#""result":null"#) {
        return Ok(ResponseData::Empty);
    }

    // Check for queue list
    if json.contains(r#""result":["#) && !json.contains(r#""id""#) {
        let queues = extract_string_array(json, "result");
        return Ok(ResponseData::QueueList(queues));
    }

    // Check for enqueue result
    if json.contains(r#""position""#) && json.contains(r#""id""#) {
        let id = extract_json_number(json, "id").unwrap_or(0);
        let position = extract_json_number(json, "position").unwrap_or(0) as usize;
        return Ok(ResponseData::EnqueueResult { id, position });
    }

    // Check for queue stats
    if json.contains(r#""depth""#) && json.contains(r#""enqueued""#) {
        let depth = extract_json_number(json, "depth").unwrap_or(0) as usize;
        let enqueued = extract_json_number(json, "enqueued").unwrap_or(0) as usize;
        let dequeued = extract_json_number(json, "dequeued").unwrap_or(0) as usize;
        let acknowledged = extract_json_number(json, "acknowledged").unwrap_or(0) as usize;
        let rejected = extract_json_number(json, "rejected").unwrap_or(0) as usize;
        let in_flight = extract_json_number(json, "in_flight").unwrap_or(0) as usize;
        return Ok(ResponseData::QueueStats {
            depth,
            enqueued,
            dequeued,
            acknowledged,
            rejected,
            in_flight,
        });
    }

    // Check for queue info
    if json.contains(r#""name""#) && json.contains(r#""depth""#) {
        let name = extract_json_string(json, "name").unwrap_or_default();
        let depth = extract_json_number(json, "depth").unwrap_or(0) as usize;
        return Ok(ResponseData::QueueInfo { name, depth });
    }

    // Check for link
    if json.contains(r#""source""#) && json.contains(r#""target""#) {
        let id = extract_json_number(json, "id").unwrap_or(0);
        let source = extract_json_number(json, "source").unwrap_or(0);
        let target = extract_json_number(json, "target").unwrap_or(0);
        return Ok(ResponseData::Link { id, source, target });
    }

    // Default to empty
    Ok(ResponseData::Empty)
}

/// Extracts a string value from JSON.
fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!(r#""{key}":""#);
    let start = json.find(&pattern)? + pattern.len();
    let end = json[start..].find('"')? + start;
    Some(json[start..end].to_string())
}

/// Extracts a number value from JSON.
fn extract_json_number(json: &str, key: &str) -> Option<u64> {
    let pattern = format!(r#""{key}":"#);
    let start = json.find(&pattern)? + pattern.len();
    let rest = &json[start..];

    // Find the end of the number
    let mut end = 0;
    for c in rest.chars() {
        if c.is_ascii_digit() {
            end += 1;
        } else {
            break;
        }
    }

    if end == 0 {
        return None;
    }

    rest[..end].parse().ok()
}

/// Extracts a string array from JSON.
fn extract_string_array(json: &str, _key: &str) -> Vec<String> {
    let mut result = Vec::new();

    // Find array start
    if let Some(start) = json.find('[') {
        if let Some(end) = json.find(']') {
            let array_str = &json[start + 1..end];
            for item in array_str.split(',') {
                let trimmed = item.trim().trim_matches('"');
                if !trimmed.is_empty() {
                    result.push(trimmed.to_string());
                }
            }
        }
    }

    result
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod connection_state_tests {
        use super::*;

        #[test]
        fn test_connection_state_display() {
            assert_eq!(format!("{}", ConnectionState::Disconnected), "disconnected");
            assert_eq!(format!("{}", ConnectionState::Connecting), "connecting");
            assert_eq!(format!("{}", ConnectionState::Connected), "connected");
            assert_eq!(format!("{}", ConnectionState::Reconnecting), "reconnecting");
        }

        #[test]
        fn test_connection_state_default() {
            let state = ConnectionState::default();
            assert_eq!(state, ConnectionState::Disconnected);
        }
    }

    mod parse_address_tests {
        use super::*;

        #[test]
        fn test_parse_address_simple() {
            let addr = parse_address("localhost:5000").unwrap();
            assert_eq!(addr, "localhost:5000");
        }

        #[test]
        fn test_parse_address_with_tcp() {
            let addr = parse_address("tcp://localhost:5000").unwrap();
            assert_eq!(addr, "localhost:5000");
        }

        #[test]
        fn test_parse_address_invalid() {
            assert!(parse_address("localhost").is_err());
        }
    }

    mod parse_response_tests {
        use super::*;

        #[test]
        fn test_parse_pong() {
            let response = parse_response_json(r#"{"ok":true,"result":"pong"}"#).unwrap();
            assert!(matches!(response, ResponseData::Pong));
        }

        #[test]
        fn test_parse_bool() {
            let response = parse_response_json(r#"{"ok":true,"result":true}"#).unwrap();
            assert!(matches!(response, ResponseData::Bool(true)));
        }

        #[test]
        fn test_parse_error() {
            let response =
                parse_response_json(r#"{"ok":false,"error":"Not found","code":"NOT_FOUND"}"#)
                    .unwrap();
            match response {
                ResponseData::Error { message, code } => {
                    assert_eq!(message, "Not found");
                    assert_eq!(code, "NOT_FOUND");
                }
                _ => panic!("Expected error response"),
            }
        }

        #[test]
        fn test_parse_queue_info() {
            let response =
                parse_response_json(r#"{"ok":true,"result":{"name":"test","depth":42}}"#).unwrap();
            match response {
                ResponseData::QueueInfo { name, depth } => {
                    assert_eq!(name, "test");
                    assert_eq!(depth, 42);
                }
                _ => panic!("Expected queue info response"),
            }
        }
    }

    mod helper_tests {
        use super::*;

        #[test]
        fn test_extract_json_string() {
            let json = r#"{"name":"test","value":"hello"}"#;
            assert_eq!(extract_json_string(json, "name"), Some("test".to_string()));
            assert_eq!(
                extract_json_string(json, "value"),
                Some("hello".to_string())
            );
        }

        #[test]
        fn test_extract_json_number() {
            let json = r#"{"id":42,"count":100}"#;
            assert_eq!(extract_json_number(json, "id"), Some(42));
            assert_eq!(extract_json_number(json, "count"), Some(100));
        }

        #[test]
        fn test_extract_string_array() {
            let json = r#"{"ok":true,"result":["a","b","c"]}"#;
            let arr = extract_string_array(json, "result");
            assert_eq!(arr, vec!["a", "b", "c"]);
        }
    }
}
