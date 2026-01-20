//! Structured logging module for links-queue.
//!
//! Provides structured logging with JSON format support, configurable log levels,
//! and correlation IDs for request tracing.

use std::collections::HashMap;
use std::fmt;
use std::io::{self, Write};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use std::cell::RefCell;

/// Log levels with numeric severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Fatal = 4,
}

impl LogLevel {
    /// Returns the string name of the log level.
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Fatal => "FATAL",
        }
    }

    /// Parses a string into a log level.
    #[must_use]
    pub fn from_str(s: &str) -> Option<LogLevel> {
        match s.to_uppercase().as_str() {
            "DEBUG" => Some(LogLevel::Debug),
            "INFO" => Some(LogLevel::Info),
            "WARN" | "WARNING" => Some(LogLevel::Warn),
            "ERROR" => Some(LogLevel::Error),
            "FATAL" => Some(LogLevel::Fatal),
            _ => None,
        }
    }
}

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl Default for LogLevel {
    fn default() -> Self {
        LogLevel::Info
    }
}

/// A structured log entry.
#[derive(Debug, Clone)]
pub struct LogEntry {
    /// Log level.
    pub level: LogLevel,
    /// Log message.
    pub message: String,
    /// Timestamp in milliseconds since Unix epoch.
    pub timestamp: u64,
    /// Optional correlation ID for request tracing.
    pub correlation_id: Option<String>,
    /// Additional fields.
    pub fields: HashMap<String, serde_json::Value>,
}

impl LogEntry {
    /// Creates a new log entry.
    #[must_use]
    pub fn new(level: LogLevel, message: impl Into<String>) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Self {
            level,
            message: message.into(),
            timestamp,
            correlation_id: LogContext::get_correlation_id(),
            fields: HashMap::new(),
        }
    }

    /// Adds a field to the log entry.
    #[must_use]
    pub fn with_field(mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) -> Self {
        self.fields.insert(key.into(), value.into());
        self
    }

    /// Adds multiple fields to the log entry.
    #[must_use]
    pub fn with_fields(mut self, fields: HashMap<String, serde_json::Value>) -> Self {
        self.fields.extend(fields);
        self
    }

    /// Formats the entry as JSON.
    #[must_use]
    pub fn to_json(&self) -> String {
        let mut obj = serde_json::Map::new();

        obj.insert("timestamp".to_string(), serde_json::json!(self.timestamp));
        obj.insert("level".to_string(), serde_json::json!(self.level.as_str()));
        obj.insert("message".to_string(), serde_json::json!(self.message));

        if let Some(ref cid) = self.correlation_id {
            obj.insert("correlationId".to_string(), serde_json::json!(cid));
        }

        for (key, value) in &self.fields {
            obj.insert(key.clone(), value.clone());
        }

        serde_json::Value::Object(obj).to_string()
    }

    /// Formats the entry as text.
    #[must_use]
    pub fn to_text(&self) -> String {
        let datetime = chrono::DateTime::from_timestamp_millis(self.timestamp as i64)
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
            .unwrap_or_else(|| self.timestamp.to_string());

        let mut parts = vec![
            datetime,
            format!("[{}]", self.level),
        ];

        if let Some(ref cid) = self.correlation_id {
            parts.push(format!("[{}]", cid));
        }

        parts.push(self.message.clone());

        // Add extra fields
        let extra: Vec<String> = self.fields
            .iter()
            .filter(|(k, _)| !k.starts_with('_'))
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();

        if !extra.is_empty() {
            parts.push(extra.join(" "));
        }

        parts.join(" ")
    }
}

// Thread-local storage for correlation IDs.
thread_local! {
    static CORRELATION_ID: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Context manager for correlation IDs.
pub struct LogContext;

impl LogContext {
    /// Gets the current correlation ID.
    #[must_use]
    pub fn get_correlation_id() -> Option<String> {
        CORRELATION_ID.with(|cid| cid.borrow().clone())
    }

    /// Sets the correlation ID for the current thread.
    pub fn set_correlation_id(id: impl Into<String>) {
        CORRELATION_ID.with(|cid| {
            *cid.borrow_mut() = Some(id.into());
        });
    }

    /// Clears the correlation ID for the current thread.
    pub fn clear_correlation_id() {
        CORRELATION_ID.with(|cid| {
            *cid.borrow_mut() = None;
        });
    }

    /// Generates a new UUID correlation ID.
    #[must_use]
    pub fn generate_correlation_id() -> String {
        uuid::Uuid::new_v4().to_string()
    }

    /// Runs a closure with a correlation ID context.
    pub fn run_with<F, R>(correlation_id: impl Into<String>, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        let id = correlation_id.into();
        let previous = Self::get_correlation_id();
        Self::set_correlation_id(id);
        let result = f();
        if let Some(prev) = previous {
            Self::set_correlation_id(prev);
        } else {
            Self::clear_correlation_id();
        }
        result
    }
}

/// Log format type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Json,
    Text,
}

impl Default for LogFormat {
    fn default() -> Self {
        LogFormat::Json
    }
}

/// Output destination for logs.
pub enum LogOutput {
    Stdout,
    Stderr,
    Writer(Box<dyn Write + Send + Sync>),
}

impl Default for LogOutput {
    fn default() -> Self {
        LogOutput::Stdout
    }
}

/// Structured logger for links-queue.
pub struct Logger {
    level: LogLevel,
    format: LogFormat,
    output: Arc<RwLock<LogOutput>>,
    default_fields: HashMap<String, serde_json::Value>,
    include_timestamp: bool,
    include_correlation_id: bool,
}

impl Logger {
    /// Creates a new Logger with default settings.
    #[must_use]
    pub fn new() -> Self {
        Self {
            level: LogLevel::Info,
            format: LogFormat::Json,
            output: Arc::new(RwLock::new(LogOutput::Stdout)),
            default_fields: HashMap::new(),
            include_timestamp: true,
            include_correlation_id: true,
        }
    }

    /// Sets the minimum log level.
    #[must_use]
    pub fn with_level(mut self, level: LogLevel) -> Self {
        self.level = level;
        self
    }

    /// Sets the log format.
    #[must_use]
    pub fn with_format(mut self, format: LogFormat) -> Self {
        self.format = format;
        self
    }

    /// Sets the output destination.
    #[must_use]
    pub fn with_output(mut self, output: LogOutput) -> Self {
        self.output = Arc::new(RwLock::new(output));
        self
    }

    /// Adds a default field.
    #[must_use]
    pub fn with_field(mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) -> Self {
        self.default_fields.insert(key.into(), value.into());
        self
    }

    /// Sets whether to include timestamps.
    #[must_use]
    pub fn with_timestamp(mut self, include: bool) -> Self {
        self.include_timestamp = include;
        self
    }

    /// Sets whether to include correlation IDs.
    #[must_use]
    pub fn with_correlation_id(mut self, include: bool) -> Self {
        self.include_correlation_id = include;
        self
    }

    /// Creates a child logger with additional default fields.
    #[must_use]
    pub fn child(&self, fields: HashMap<String, serde_json::Value>) -> Self {
        let mut new_fields = self.default_fields.clone();
        new_fields.extend(fields);

        Self {
            level: self.level,
            format: self.format,
            output: Arc::clone(&self.output),
            default_fields: new_fields,
            include_timestamp: self.include_timestamp,
            include_correlation_id: self.include_correlation_id,
        }
    }

    /// Gets the current log level.
    #[must_use]
    pub fn level(&self) -> LogLevel {
        self.level
    }

    /// Sets the log level.
    pub fn set_level(&mut self, level: LogLevel) {
        self.level = level;
    }

    /// Checks if a level is enabled.
    #[must_use]
    pub fn is_level_enabled(&self, level: LogLevel) -> bool {
        level >= self.level
    }

    /// Logs a message at the specified level.
    pub fn log(&self, level: LogLevel, message: impl Into<String>, fields: Option<HashMap<String, serde_json::Value>>) {
        if level < self.level {
            return;
        }

        let mut entry = LogEntry::new(level, message);

        // Add default fields
        entry.fields.extend(self.default_fields.clone());

        // Add provided fields
        if let Some(f) = fields {
            entry.fields.extend(f);
        }

        // Handle timestamp inclusion
        if !self.include_timestamp {
            entry.timestamp = 0;
        }

        // Handle correlation ID inclusion
        if !self.include_correlation_id {
            entry.correlation_id = None;
        }

        let output = match self.format {
            LogFormat::Json => entry.to_json(),
            LogFormat::Text => entry.to_text(),
        };

        self.write(&format!("{}\n", output));
    }

    /// Writes output to the destination.
    fn write(&self, data: &str) {
        if let Ok(mut output) = self.output.write() {
            let result = match &mut *output {
                LogOutput::Stdout => io::stdout().write_all(data.as_bytes()),
                LogOutput::Stderr => io::stderr().write_all(data.as_bytes()),
                LogOutput::Writer(w) => w.write_all(data.as_bytes()),
            };
            if let Err(e) = result {
                eprintln!("Logger write error: {}", e);
            }
        }
    }

    /// Logs a debug message.
    pub fn debug(&self, message: impl Into<String>) {
        self.log(LogLevel::Debug, message, None);
    }

    /// Logs a debug message with fields.
    pub fn debug_with(&self, message: impl Into<String>, fields: HashMap<String, serde_json::Value>) {
        self.log(LogLevel::Debug, message, Some(fields));
    }

    /// Logs an info message.
    pub fn info(&self, message: impl Into<String>) {
        self.log(LogLevel::Info, message, None);
    }

    /// Logs an info message with fields.
    pub fn info_with(&self, message: impl Into<String>, fields: HashMap<String, serde_json::Value>) {
        self.log(LogLevel::Info, message, Some(fields));
    }

    /// Logs a warning message.
    pub fn warn(&self, message: impl Into<String>) {
        self.log(LogLevel::Warn, message, None);
    }

    /// Logs a warning message with fields.
    pub fn warn_with(&self, message: impl Into<String>, fields: HashMap<String, serde_json::Value>) {
        self.log(LogLevel::Warn, message, Some(fields));
    }

    /// Logs an error message.
    pub fn error(&self, message: impl Into<String>) {
        self.log(LogLevel::Error, message, None);
    }

    /// Logs an error message with fields.
    pub fn error_with(&self, message: impl Into<String>, fields: HashMap<String, serde_json::Value>) {
        self.log(LogLevel::Error, message, Some(fields));
    }

    /// Logs a fatal message.
    pub fn fatal(&self, message: impl Into<String>) {
        self.log(LogLevel::Fatal, message, None);
    }

    /// Logs a fatal message with fields.
    pub fn fatal_with(&self, message: impl Into<String>, fields: HashMap<String, serde_json::Value>) {
        self.log(LogLevel::Fatal, message, Some(fields));
    }
}

impl Default for Logger {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for Logger {
    fn clone(&self) -> Self {
        Self {
            level: self.level,
            format: self.format,
            output: Arc::clone(&self.output),
            default_fields: self.default_fields.clone(),
            include_timestamp: self.include_timestamp,
            include_correlation_id: self.include_correlation_id,
        }
    }
}

/// Creates a logger with queue-specific context.
#[must_use]
pub fn create_queue_logger(queue_name: &str, component: Option<&str>) -> Logger {
    let mut logger = Logger::new();
    logger.default_fields.insert("queue".to_string(), serde_json::json!(queue_name));
    if let Some(comp) = component {
        logger.default_fields.insert("component".to_string(), serde_json::json!(comp));
    }
    logger
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_ordering() {
        assert!(LogLevel::Debug < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Warn);
        assert!(LogLevel::Warn < LogLevel::Error);
        assert!(LogLevel::Error < LogLevel::Fatal);
    }

    #[test]
    fn test_log_level_from_str() {
        assert_eq!(LogLevel::from_str("debug"), Some(LogLevel::Debug));
        assert_eq!(LogLevel::from_str("INFO"), Some(LogLevel::Info));
        assert_eq!(LogLevel::from_str("Warning"), Some(LogLevel::Warn));
        assert_eq!(LogLevel::from_str("ERROR"), Some(LogLevel::Error));
        assert_eq!(LogLevel::from_str("fatal"), Some(LogLevel::Fatal));
        assert_eq!(LogLevel::from_str("invalid"), None);
    }

    #[test]
    fn test_log_entry_json() {
        let entry = LogEntry::new(LogLevel::Info, "Test message")
            .with_field("key", "value");

        let json = entry.to_json();
        assert!(json.contains("\"level\":\"INFO\""));
        assert!(json.contains("\"message\":\"Test message\""));
        assert!(json.contains("\"key\":\"value\""));
    }

    #[test]
    fn test_log_entry_text() {
        let entry = LogEntry::new(LogLevel::Info, "Test message");
        let text = entry.to_text();

        assert!(text.contains("[INFO]"));
        assert!(text.contains("Test message"));
    }

    #[test]
    fn test_correlation_id() {
        LogContext::set_correlation_id("test-123");
        assert_eq!(LogContext::get_correlation_id(), Some("test-123".to_string()));

        LogContext::clear_correlation_id();
        assert_eq!(LogContext::get_correlation_id(), None);
    }

    #[test]
    fn test_correlation_id_run_with() {
        LogContext::clear_correlation_id();

        LogContext::run_with("outer-id", || {
            assert_eq!(LogContext::get_correlation_id(), Some("outer-id".to_string()));

            LogContext::run_with("inner-id", || {
                assert_eq!(LogContext::get_correlation_id(), Some("inner-id".to_string()));
            });

            assert_eq!(LogContext::get_correlation_id(), Some("outer-id".to_string()));
        });

        assert_eq!(LogContext::get_correlation_id(), None);
    }

    #[test]
    fn test_logger_level() {
        let logger = Logger::new().with_level(LogLevel::Warn);

        assert!(logger.is_level_enabled(LogLevel::Warn));
        assert!(logger.is_level_enabled(LogLevel::Error));
        assert!(!logger.is_level_enabled(LogLevel::Debug));
        assert!(!logger.is_level_enabled(LogLevel::Info));
    }

    #[test]
    fn test_logger_child() {
        let parent = Logger::new()
            .with_field("parent_field", "parent_value");

        let mut child_fields = HashMap::new();
        child_fields.insert("child_field".to_string(), serde_json::json!("child_value"));
        let child = parent.child(child_fields);

        assert!(child.default_fields.contains_key("parent_field"));
        assert!(child.default_fields.contains_key("child_field"));
    }

    #[test]
    fn test_create_queue_logger() {
        let logger = create_queue_logger("test-queue", Some("worker"));

        assert!(logger.default_fields.contains_key("queue"));
        assert!(logger.default_fields.contains_key("component"));
    }
}
