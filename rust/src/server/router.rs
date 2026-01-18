//! Request routing for Links Queue TCP server.
//!
//! This module handles parsing incoming requests and routing them to
//! the appropriate queue operations.

// Allow clippy warnings for this module (new code, will be refined in future PRs)
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::missing_const_for_fn)]
#![allow(clippy::doc_markdown)]
#![allow(clippy::manual_let_else)]
#![allow(clippy::unnecessary_wraps)]
#![allow(dead_code)]

use std::collections::HashMap;
use std::fmt::Display;
use std::str::FromStr;
use std::sync::Arc;

use crate::{Link, LinkRef, LinkType, MemoryQueueManager, Queue, QueueManager, QueueOptions};

use super::traits::{ServerError, ServerResult};

// =============================================================================
// Operation Types
// =============================================================================

/// Supported server operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Operation {
    /// Ping/pong for connection health.
    Ping,
    /// Create a new queue.
    CreateQueue,
    /// Delete a queue.
    DeleteQueue,
    /// Get queue information.
    GetQueue,
    /// List all queues.
    ListQueues,
    /// Enqueue a link to a queue.
    Enqueue,
    /// Dequeue a link from a queue.
    Dequeue,
    /// Peek at the next link without dequeuing.
    Peek,
    /// Acknowledge a dequeued link.
    Acknowledge,
    /// Reject a dequeued link.
    Reject,
    /// Get queue statistics.
    Stats,
    /// Subscribe to queue updates.
    Subscribe,
    /// Unsubscribe from queue updates.
    Unsubscribe,
}

impl Display for Operation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ping => write!(f, "ping"),
            Self::CreateQueue => write!(f, "create_queue"),
            Self::DeleteQueue => write!(f, "delete_queue"),
            Self::GetQueue => write!(f, "get_queue"),
            Self::ListQueues => write!(f, "list_queues"),
            Self::Enqueue => write!(f, "enqueue"),
            Self::Dequeue => write!(f, "dequeue"),
            Self::Peek => write!(f, "peek"),
            Self::Acknowledge => write!(f, "acknowledge"),
            Self::Reject => write!(f, "reject"),
            Self::Stats => write!(f, "stats"),
            Self::Subscribe => write!(f, "subscribe"),
            Self::Unsubscribe => write!(f, "unsubscribe"),
        }
    }
}

impl FromStr for Operation {
    type Err = ServerError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "ping" => Ok(Self::Ping),
            "create_queue" | "createqueue" => Ok(Self::CreateQueue),
            "delete_queue" | "deletequeue" => Ok(Self::DeleteQueue),
            "get_queue" | "getqueue" => Ok(Self::GetQueue),
            "list_queues" | "listqueues" => Ok(Self::ListQueues),
            "enqueue" => Ok(Self::Enqueue),
            "dequeue" => Ok(Self::Dequeue),
            "peek" => Ok(Self::Peek),
            "acknowledge" | "ack" => Ok(Self::Acknowledge),
            "reject" | "nack" => Ok(Self::Reject),
            "stats" => Ok(Self::Stats),
            "subscribe" | "sub" => Ok(Self::Subscribe),
            "unsubscribe" | "unsub" => Ok(Self::Unsubscribe),
            _ => Err(ServerError::protocol_error(&format!(
                "Unknown operation: {s}"
            ))),
        }
    }
}

// =============================================================================
// Request
// =============================================================================

/// A parsed request from the client.
#[derive(Debug, Clone)]
pub struct Request {
    /// The operation to perform.
    pub op: Operation,

    /// Queue name (for queue operations).
    pub queue: Option<String>,

    /// Link data (for enqueue operations).
    pub link: Option<LinkData>,

    /// Link ID (for acknowledge/reject operations).
    pub id: Option<u64>,

    /// Whether to requeue on reject.
    pub requeue: Option<bool>,

    /// Queue options (for create_queue).
    pub options: Option<QueueOptionsData>,
}

/// Link data in a request.
#[derive(Debug, Clone)]
pub struct LinkData {
    /// Link ID (0 for auto-assign).
    pub id: u64,
    /// Source reference.
    pub source: u64,
    /// Target reference.
    pub target: u64,
    /// Optional additional values.
    pub values: Option<Vec<u64>>,
}

/// Queue options data in a request.
#[derive(Debug, Clone, Default)]
pub struct QueueOptionsData {
    /// Maximum queue size.
    pub max_size: Option<usize>,
    /// Visibility timeout in seconds.
    pub visibility_timeout: Option<u64>,
    /// Retry limit.
    pub retry_limit: Option<u32>,
    /// Dead letter queue name.
    pub dead_letter_queue: Option<String>,
    /// Enable priority ordering.
    pub priority: Option<bool>,
}

impl Request {
    /// Creates a new ping request.
    #[must_use]
    pub fn ping() -> Self {
        Self {
            op: Operation::Ping,
            queue: None,
            link: None,
            id: None,
            requeue: None,
            options: None,
        }
    }

    /// Creates a new request for the given operation.
    #[must_use]
    pub fn new(op: Operation) -> Self {
        Self {
            op,
            queue: None,
            link: None,
            id: None,
            requeue: None,
            options: None,
        }
    }

    /// Sets the queue name.
    #[must_use]
    pub fn with_queue(mut self, queue: impl Into<String>) -> Self {
        self.queue = Some(queue.into());
        self
    }

    /// Sets the link data.
    #[must_use]
    pub fn with_link(mut self, link: LinkData) -> Self {
        self.link = Some(link);
        self
    }

    /// Sets the link ID.
    #[must_use]
    pub fn with_id(mut self, id: u64) -> Self {
        self.id = Some(id);
        self
    }

    /// Sets the requeue flag.
    #[must_use]
    pub fn with_requeue(mut self, requeue: bool) -> Self {
        self.requeue = Some(requeue);
        self
    }

    /// Parses a request from JSON bytes.
    pub fn parse(data: &[u8]) -> ServerResult<Self> {
        let s = std::str::from_utf8(data)
            .map_err(|e| ServerError::protocol_error(&format!("Invalid UTF-8: {e}")))?;

        Self::parse_json(s)
    }

    /// Parses a request from a JSON string.
    ///
    /// Format:
    /// ```json
    /// {
    ///   "op": "enqueue",
    ///   "queue": "tasks",
    ///   "link": {"id": 0, "source": 1, "target": 2}
    /// }
    /// ```
    fn parse_json(json: &str) -> ServerResult<Self> {
        // Simple JSON parser (avoiding external dependencies)
        let json = json.trim();

        if !json.starts_with('{') || !json.ends_with('}') {
            return Err(ServerError::protocol_error("Expected JSON object"));
        }

        let inner = &json[1..json.len() - 1];
        let fields = parse_json_fields(inner)?;

        // Get operation
        let op_str = fields
            .get("op")
            .ok_or_else(|| ServerError::protocol_error("Missing 'op' field"))?;
        let op: Operation = op_str.parse()?;

        // Get queue name
        let queue = fields.get("queue").map(|s| s.trim_matches('"').to_string());

        // Get link data
        let link = if let Some(link_str) = fields.get("link") {
            Some(parse_link_data(link_str)?)
        } else {
            None
        };

        // Get id
        let id = fields
            .get("id")
            .and_then(|s| s.trim_matches('"').parse().ok());

        // Get requeue
        let requeue = fields.get("requeue").map(|s| s == "true");

        // Get options
        let options = if let Some(opts_str) = fields.get("options") {
            Some(parse_queue_options(opts_str)?)
        } else {
            None
        };

        Ok(Self {
            op,
            queue,
            link,
            id,
            requeue,
            options,
        })
    }
}

// =============================================================================
// Response
// =============================================================================

/// A response to send to the client.
#[derive(Debug, Clone)]
pub struct Response {
    /// Whether the operation succeeded.
    pub ok: bool,

    /// Result data (on success).
    pub result: Option<ResponseData>,

    /// Error message (on failure).
    pub error: Option<String>,

    /// Error code (on failure).
    pub code: Option<String>,
}

/// Response data variants.
#[derive(Debug, Clone)]
pub enum ResponseData {
    /// Pong response.
    Pong,
    /// Link data.
    Link(LinkData),
    /// Multiple links.
    Links(Vec<LinkData>),
    /// Queue info.
    QueueInfo { name: String, depth: usize },
    /// Queue stats.
    QueueStats {
        depth: usize,
        enqueued: usize,
        dequeued: usize,
        acknowledged: usize,
        rejected: usize,
        in_flight: usize,
    },
    /// List of queue names.
    QueueList(Vec<String>),
    /// Enqueue result.
    EnqueueResult { id: u64, position: usize },
    /// Boolean result.
    Bool(bool),
    /// Empty result.
    Empty,
}

impl Response {
    /// Creates a successful response.
    #[must_use]
    pub fn ok(result: ResponseData) -> Self {
        Self {
            ok: true,
            result: Some(result),
            error: None,
            code: None,
        }
    }

    /// Creates an error response.
    #[must_use]
    pub fn error(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            ok: false,
            result: None,
            error: Some(message.into()),
            code: Some(code.into()),
        }
    }

    /// Creates a pong response.
    #[must_use]
    pub fn pong() -> Self {
        Self::ok(ResponseData::Pong)
    }

    /// Serializes the response to JSON bytes.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.to_json().into_bytes()
    }

    /// Serializes the response to a JSON string.
    #[must_use]
    pub fn to_json(&self) -> String {
        if self.ok {
            match &self.result {
                Some(ResponseData::Pong) => r#"{"ok":true,"result":"pong"}"#.to_string(),
                Some(ResponseData::Link(link)) => {
                    format!(
                        r#"{{"ok":true,"result":{{"id":{},"source":{},"target":{}}}}}"#,
                        link.id, link.source, link.target
                    )
                }
                Some(ResponseData::Links(links)) => {
                    let links_json: Vec<String> = links
                        .iter()
                        .map(|l| {
                            format!(
                                r#"{{"id":{},"source":{},"target":{}}}"#,
                                l.id, l.source, l.target
                            )
                        })
                        .collect();
                    format!(r#"{{"ok":true,"result":[{}]}}"#, links_json.join(","))
                }
                Some(ResponseData::QueueInfo { name, depth }) => {
                    format!(r#"{{"ok":true,"result":{{"name":"{name}","depth":{depth}}}}}"#)
                }
                Some(ResponseData::QueueStats {
                    depth,
                    enqueued,
                    dequeued,
                    acknowledged,
                    rejected,
                    in_flight,
                }) => {
                    format!(
                        r#"{{"ok":true,"result":{{"depth":{depth},"enqueued":{enqueued},"dequeued":{dequeued},"acknowledged":{acknowledged},"rejected":{rejected},"in_flight":{in_flight}}}}}"#
                    )
                }
                Some(ResponseData::QueueList(queues)) => {
                    let queues_json: Vec<String> =
                        queues.iter().map(|q| format!(r#""{q}""#)).collect();
                    format!(r#"{{"ok":true,"result":[{}]}}"#, queues_json.join(","))
                }
                Some(ResponseData::EnqueueResult { id, position }) => {
                    format!(r#"{{"ok":true,"result":{{"id":{id},"position":{position}}}}}"#)
                }
                Some(ResponseData::Bool(b)) => {
                    format!(r#"{{"ok":true,"result":{b}}}"#)
                }
                Some(ResponseData::Empty) | None => r#"{"ok":true}"#.to_string(),
            }
        } else {
            let error = self.error.as_deref().unwrap_or("Unknown error");
            let code = self.code.as_deref().unwrap_or("UNKNOWN");
            format!(r#"{{"ok":false,"error":"{error}","code":"{code}"}}"#)
        }
    }
}

// =============================================================================
// Router
// =============================================================================

/// Routes incoming requests to queue operations.
///
/// The router maintains a reference to the queue manager and dispatches
/// requests to the appropriate operations.
pub struct Router<T: LinkType> {
    /// Queue manager for performing operations.
    manager: Arc<MemoryQueueManager<T>>,
}

impl<T: LinkType + FromStr + Display> Router<T>
where
    <T as FromStr>::Err: std::fmt::Debug,
{
    /// Creates a new router with the given queue manager.
    #[must_use]
    pub fn new(manager: Arc<MemoryQueueManager<T>>) -> Self {
        Self { manager }
    }

    /// Routes a request and returns a response.
    pub async fn route(&self, request: &Request) -> Response {
        match request.op {
            Operation::Ping => Response::pong(),
            Operation::CreateQueue => self.create_queue(request).await,
            Operation::DeleteQueue => self.delete_queue(request).await,
            Operation::GetQueue => self.get_queue(request).await,
            Operation::ListQueues => self.list_queues().await,
            Operation::Enqueue => self.enqueue(request).await,
            Operation::Dequeue => self.dequeue(request).await,
            Operation::Peek => self.peek(request).await,
            Operation::Acknowledge => self.acknowledge(request).await,
            Operation::Reject => self.reject(request).await,
            Operation::Stats => self.stats(request).await,
            Operation::Subscribe => {
                Response::error("Subscribe not yet implemented", "NOT_IMPLEMENTED")
            }
            Operation::Unsubscribe => {
                Response::error("Unsubscribe not yet implemented", "NOT_IMPLEMENTED")
            }
        }
    }

    async fn create_queue(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let options = request
            .options
            .as_ref()
            .map(|o| {
                let mut opts = QueueOptions::default();
                if let Some(max_size) = o.max_size {
                    opts = opts.with_max_size(max_size);
                }
                if let Some(visibility_timeout) = o.visibility_timeout {
                    opts = opts.with_visibility_timeout(visibility_timeout);
                }
                if let Some(retry_limit) = o.retry_limit {
                    opts = opts.with_retry_limit(retry_limit);
                }
                if let Some(ref dlq) = o.dead_letter_queue {
                    opts = opts.with_dead_letter_queue(dlq.clone());
                }
                if let Some(priority) = o.priority {
                    opts = opts.with_priority(priority);
                }
                opts
            })
            .unwrap_or_default();

        match self.manager.create_queue(queue_name, options).await {
            Ok(_queue) => Response::ok(ResponseData::QueueInfo {
                name: queue_name.clone(),
                depth: 0,
            }),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn delete_queue(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        match self.manager.delete_queue(queue_name).await {
            Ok(deleted) => Response::ok(ResponseData::Bool(deleted)),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn get_queue(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        match self.manager.get_queue(queue_name).await {
            Ok(Some(queue)) => Response::ok(ResponseData::QueueInfo {
                name: queue_name.clone(),
                depth: queue.depth(),
            }),
            Ok(None) => Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn list_queues(&self) -> Response {
        match self.manager.list_queues().await {
            Ok(queues) => {
                let names: Vec<String> = queues.into_iter().map(|q| q.name).collect();
                Response::ok(ResponseData::QueueList(names))
            }
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn enqueue(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let link_data = match &request.link {
            Some(data) => data,
            None => return Response::error("Missing link data", "MISSING_LINK"),
        };

        // Get the queue
        let queue = match self.manager.get_queue(queue_name).await {
            Ok(Some(q)) => q,
            Ok(None) => return Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => return Response::error(e.message, format!("{}", e.code)),
        };

        // Parse the link
        let source_str = link_data.source.to_string();
        let target_str = link_data.target.to_string();

        let source = match source_str.parse::<T>() {
            Ok(s) => s,
            Err(_) => return Response::error("Invalid source ID", "INVALID_SOURCE"),
        };

        let target = match target_str.parse::<T>() {
            Ok(t) => t,
            Err(_) => return Response::error("Invalid target ID", "INVALID_TARGET"),
        };

        let id_str = link_data.id.to_string();
        let id = match id_str.parse::<T>() {
            Ok(i) => i,
            Err(_) => return Response::error("Invalid link ID", "INVALID_ID"),
        };

        let link = Link::new(id, LinkRef::Id(source), LinkRef::Id(target));

        match queue.enqueue(link).await {
            Ok(result) => {
                // Convert ID back to u64 for response
                let id_u64: u64 = format!("{:?}", result.id).parse().unwrap_or(0);
                Response::ok(ResponseData::EnqueueResult {
                    id: id_u64,
                    position: result.position,
                })
            }
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn dequeue(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let queue = match self.manager.get_queue(queue_name).await {
            Ok(Some(q)) => q,
            Ok(None) => return Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => return Response::error(e.message, format!("{}", e.code)),
        };

        match queue.dequeue().await {
            Ok(Some(link)) => {
                let id_u64: u64 = format!("{:?}", link.id).parse().unwrap_or(0);
                let source_u64: u64 = format!("{:?}", link.source_id()).parse().unwrap_or(0);
                let target_u64: u64 = format!("{:?}", link.target_id()).parse().unwrap_or(0);

                Response::ok(ResponseData::Link(LinkData {
                    id: id_u64,
                    source: source_u64,
                    target: target_u64,
                    values: None,
                }))
            }
            Ok(None) => Response::ok(ResponseData::Empty),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn peek(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let queue = match self.manager.get_queue(queue_name).await {
            Ok(Some(q)) => q,
            Ok(None) => return Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => return Response::error(e.message, format!("{}", e.code)),
        };

        match queue.peek().await {
            Ok(Some(link)) => {
                let id_u64: u64 = format!("{:?}", link.id).parse().unwrap_or(0);
                let source_u64: u64 = format!("{:?}", link.source_id()).parse().unwrap_or(0);
                let target_u64: u64 = format!("{:?}", link.target_id()).parse().unwrap_or(0);

                Response::ok(ResponseData::Link(LinkData {
                    id: id_u64,
                    source: source_u64,
                    target: target_u64,
                    values: None,
                }))
            }
            Ok(None) => Response::ok(ResponseData::Empty),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn acknowledge(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let id = match request.id {
            Some(id) => id,
            None => return Response::error("Missing item ID", "MISSING_ID"),
        };

        let queue = match self.manager.get_queue(queue_name).await {
            Ok(Some(q)) => q,
            Ok(None) => return Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => return Response::error(e.message, format!("{}", e.code)),
        };

        let id_str = id.to_string();
        let typed_id = match id_str.parse::<T>() {
            Ok(i) => i,
            Err(_) => return Response::error("Invalid ID", "INVALID_ID"),
        };

        match queue.acknowledge(typed_id).await {
            Ok(()) => Response::ok(ResponseData::Bool(true)),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn reject(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let id = match request.id {
            Some(id) => id,
            None => return Response::error("Missing item ID", "MISSING_ID"),
        };

        let requeue = request.requeue.unwrap_or(true);

        let queue = match self.manager.get_queue(queue_name).await {
            Ok(Some(q)) => q,
            Ok(None) => return Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => return Response::error(e.message, format!("{}", e.code)),
        };

        let id_str = id.to_string();
        let typed_id = match id_str.parse::<T>() {
            Ok(i) => i,
            Err(_) => return Response::error("Invalid ID", "INVALID_ID"),
        };

        match queue.reject(typed_id, requeue).await {
            Ok(()) => Response::ok(ResponseData::Bool(true)),
            Err(e) => Response::error(e.message, format!("{}", e.code)),
        }
    }

    async fn stats(&self, request: &Request) -> Response {
        let queue_name = match &request.queue {
            Some(name) => name,
            None => return Response::error("Missing queue name", "MISSING_QUEUE"),
        };

        let queue = match self.manager.get_queue(queue_name).await {
            Ok(Some(q)) => q,
            Ok(None) => return Response::error("Queue not found", "QUEUE_NOT_FOUND"),
            Err(e) => return Response::error(e.message, format!("{}", e.code)),
        };

        let stats = queue.stats();
        Response::ok(ResponseData::QueueStats {
            depth: stats.depth,
            enqueued: stats.enqueued,
            dequeued: stats.dequeued,
            acknowledged: stats.acknowledged,
            rejected: stats.rejected,
            in_flight: stats.in_flight,
        })
    }
}

// =============================================================================
// JSON Parsing Helpers
// =============================================================================

/// Simple JSON field parser (no external dependencies).
fn parse_json_fields(json: &str) -> ServerResult<HashMap<String, String>> {
    let mut fields = HashMap::new();
    let json = json.trim();
    let mut i = 0;
    let bytes = json.as_bytes();

    while i < bytes.len() {
        // Skip whitespace
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }

        // Parse key (must start with quote)
        if bytes[i] != b'"' {
            i += 1;
            continue;
        }
        i += 1;
        let key_start = i;
        while i < bytes.len() && bytes[i] != b'"' {
            i += 1;
        }
        let key = String::from_utf8_lossy(&bytes[key_start..i]).to_string();
        i += 1; // skip closing quote

        // Skip colon and whitespace
        while i < bytes.len() && (bytes[i] == b':' || bytes[i].is_ascii_whitespace()) {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }

        // Parse value
        let value_start = i;
        let value: String;
        if bytes[i] == b'"' {
            // String value
            i += 1;
            let content_start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i += 1;
            }
            value = String::from_utf8_lossy(&bytes[content_start..i]).to_string();
            i += 1; // skip closing quote
        } else if bytes[i] == b'{' {
            // Object value - read until matching brace
            let mut brace_depth = 1;
            i += 1;
            while i < bytes.len() && brace_depth > 0 {
                if bytes[i] == b'{' {
                    brace_depth += 1;
                } else if bytes[i] == b'}' {
                    brace_depth -= 1;
                }
                i += 1;
            }
            value = String::from_utf8_lossy(&bytes[value_start..i]).to_string();
        } else if bytes[i] == b'[' {
            // Array value - read until matching bracket
            let mut bracket_depth = 1;
            i += 1;
            while i < bytes.len() && bracket_depth > 0 {
                if bytes[i] == b'[' {
                    bracket_depth += 1;
                } else if bytes[i] == b']' {
                    bracket_depth -= 1;
                }
                i += 1;
            }
            value = String::from_utf8_lossy(&bytes[value_start..i]).to_string();
        } else {
            // Number, boolean, null - read until comma or end
            while i < bytes.len() && bytes[i] != b',' && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            value = String::from_utf8_lossy(&bytes[value_start..i])
                .trim()
                .to_string();
        }

        fields.insert(key, value);

        // Skip comma and whitespace
        while i < bytes.len() && (bytes[i] == b',' || bytes[i].is_ascii_whitespace()) {
            i += 1;
        }
    }

    Ok(fields)
}

/// Parse link data from JSON.
fn parse_link_data(json: &str) -> ServerResult<LinkData> {
    let json = json.trim();
    if !json.starts_with('{') || !json.ends_with('}') {
        return Err(ServerError::protocol_error("Invalid link data format"));
    }

    let fields = parse_json_fields(&json[1..json.len() - 1])?;

    let id = fields
        .get("id")
        .and_then(|s| s.trim_matches('"').parse().ok())
        .unwrap_or(0);

    let source = fields
        .get("source")
        .and_then(|s| s.trim_matches('"').parse().ok())
        .ok_or_else(|| ServerError::protocol_error("Missing source in link data"))?;

    let target = fields
        .get("target")
        .and_then(|s| s.trim_matches('"').parse().ok())
        .ok_or_else(|| ServerError::protocol_error("Missing target in link data"))?;

    Ok(LinkData {
        id,
        source,
        target,
        values: None,
    })
}

/// Parse queue options from JSON.
fn parse_queue_options(json: &str) -> ServerResult<QueueOptionsData> {
    let json = json.trim();
    if !json.starts_with('{') || !json.ends_with('}') {
        return Err(ServerError::protocol_error("Invalid options format"));
    }

    let fields = parse_json_fields(&json[1..json.len() - 1])?;

    Ok(QueueOptionsData {
        max_size: fields.get("max_size").and_then(|s| s.parse().ok()),
        visibility_timeout: fields
            .get("visibility_timeout")
            .and_then(|s| s.parse().ok()),
        retry_limit: fields.get("retry_limit").and_then(|s| s.parse().ok()),
        dead_letter_queue: fields
            .get("dead_letter_queue")
            .map(|s| s.trim_matches('"').to_string()),
        priority: fields.get("priority").map(|s| s == "true"),
    })
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod operation_tests {
        use super::*;

        #[test]
        fn test_operation_display() {
            assert_eq!(format!("{}", Operation::Ping), "ping");
            assert_eq!(format!("{}", Operation::Enqueue), "enqueue");
            assert_eq!(format!("{}", Operation::Dequeue), "dequeue");
        }

        #[test]
        fn test_operation_from_str() {
            assert_eq!("ping".parse::<Operation>().unwrap(), Operation::Ping);
            assert_eq!("enqueue".parse::<Operation>().unwrap(), Operation::Enqueue);
            assert_eq!("ack".parse::<Operation>().unwrap(), Operation::Acknowledge);
            assert_eq!("nack".parse::<Operation>().unwrap(), Operation::Reject);
        }

        #[test]
        fn test_operation_from_str_invalid() {
            assert!("invalid".parse::<Operation>().is_err());
        }
    }

    mod request_tests {
        use super::*;

        #[test]
        fn test_request_ping() {
            let req = Request::ping();
            assert_eq!(req.op, Operation::Ping);
        }

        #[test]
        fn test_request_parse_ping() {
            let req = Request::parse(br#"{"op": "ping"}"#).unwrap();
            assert_eq!(req.op, Operation::Ping);
        }

        #[test]
        fn test_request_parse_enqueue() {
            let req = Request::parse(
                br#"{"op": "enqueue", "queue": "tasks", "link": {"id": 0, "source": 1, "target": 2}}"#,
            )
            .unwrap();
            assert_eq!(req.op, Operation::Enqueue);
            assert_eq!(req.queue, Some("tasks".to_string()));
            assert!(req.link.is_some());
        }

        #[test]
        fn test_request_parse_invalid_json() {
            assert!(Request::parse(b"not json").is_err());
        }
    }

    mod response_tests {
        use super::*;

        #[test]
        fn test_response_pong() {
            let resp = Response::pong();
            assert!(resp.ok);
            let json = resp.to_json();
            assert!(json.contains("pong"));
        }

        #[test]
        fn test_response_error() {
            let resp = Response::error("Something failed", "FAILED");
            assert!(!resp.ok);
            let json = resp.to_json();
            assert!(json.contains("Something failed"));
            assert!(json.contains("FAILED"));
        }

        #[test]
        fn test_response_link() {
            let resp = Response::ok(ResponseData::Link(LinkData {
                id: 1,
                source: 2,
                target: 3,
                values: None,
            }));
            let json = resp.to_json();
            assert!(json.contains("\"id\":1"));
            assert!(json.contains("\"source\":2"));
            assert!(json.contains("\"target\":3"));
        }

        #[test]
        fn test_response_enqueue_result() {
            let resp = Response::ok(ResponseData::EnqueueResult {
                id: 42,
                position: 0,
            });
            let json = resp.to_json();
            assert!(json.contains("\"id\":42"));
            assert!(json.contains("\"position\":0"));
        }
    }

    mod json_parsing_tests {
        use super::*;

        #[test]
        fn test_parse_json_fields() {
            let fields = parse_json_fields(r#""op": "ping", "queue": "test""#).unwrap();
            assert_eq!(fields.get("op").map(|s| s.as_str()), Some("ping"));
            assert_eq!(fields.get("queue").map(|s| s.as_str()), Some("test"));
        }

        #[test]
        fn test_parse_link_data() {
            let link = parse_link_data(r#"{"id": 1, "source": 2, "target": 3}"#).unwrap();
            assert_eq!(link.id, 1);
            assert_eq!(link.source, 2);
            assert_eq!(link.target, 3);
        }
    }
}
