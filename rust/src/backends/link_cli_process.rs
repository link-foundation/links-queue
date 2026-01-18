//! Process management for link-cli backend.
//!
//! This module handles spawning, communicating with, and managing the lifecycle
//! of link-cli child processes.
//!
//! # Overview
//!
//! The `LinkCliProcess` struct manages:
//! - Spawning the link-cli (clink) process
//! - Sending commands via stdin
//! - Reading responses from stdout
//! - Handling process crashes and restarts
//! - Graceful shutdown
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::backends::link_cli_process::{LinkCliProcess, ProcessConfig};
//!
//! let config = ProcessConfig::new("./data/db.links");
//! let mut process = LinkCliProcess::new(config);
//!
//! process.start().await?;
//! let response = process.execute("() ((1 2))").await?;
//! process.stop().await?;
//! ```

use std::io;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

// =============================================================================
// Process Configuration
// =============================================================================

/// Configuration for the link-cli process.
#[derive(Debug, Clone)]
pub struct ProcessConfig {
    /// Path to the database file.
    pub db_path: PathBuf,

    /// Path to the link-cli binary (defaults to "clink" in PATH).
    pub binary_path: Option<PathBuf>,

    /// Timeout for command execution in milliseconds.
    pub command_timeout_ms: u64,

    /// Whether to auto-restart on crash.
    pub auto_restart: bool,

    /// Maximum restart attempts before giving up.
    pub max_restart_attempts: u32,
}

impl ProcessConfig {
    /// Creates a new process configuration with the given database path.
    ///
    /// # Arguments
    ///
    /// * `db_path` - Path to the database file
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::backends::link_cli_process::ProcessConfig;
    ///
    /// let config = ProcessConfig::new("./data/db.links");
    /// ```
    #[must_use]
    pub fn new(db_path: impl Into<PathBuf>) -> Self {
        Self {
            db_path: db_path.into(),
            binary_path: None,
            command_timeout_ms: 30_000, // 30 seconds default
            auto_restart: true,
            max_restart_attempts: 3,
        }
    }

    /// Sets a custom binary path for link-cli.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the link-cli binary
    #[must_use]
    pub fn with_binary_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.binary_path = Some(path.into());
        self
    }

    /// Sets the command execution timeout.
    ///
    /// # Arguments
    ///
    /// * `timeout_ms` - Timeout in milliseconds
    #[must_use]
    pub const fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.command_timeout_ms = timeout_ms;
        self
    }

    /// Sets whether to auto-restart on crash.
    ///
    /// # Arguments
    ///
    /// * `auto_restart` - Whether to auto-restart
    #[must_use]
    pub const fn with_auto_restart(mut self, auto_restart: bool) -> Self {
        self.auto_restart = auto_restart;
        self
    }

    /// Gets the binary path, defaulting to "clink".
    fn binary(&self) -> &str {
        self.binary_path
            .as_ref()
            .and_then(|p| p.to_str())
            .unwrap_or("clink")
    }
}

impl Default for ProcessConfig {
    fn default() -> Self {
        Self::new("db.links")
    }
}

// =============================================================================
// Process Error
// =============================================================================

/// Error that can occur during process operations.
#[derive(Debug)]
pub enum ProcessError {
    /// Failed to spawn the process.
    SpawnFailed(io::Error),
    /// Process is not running.
    NotRunning,
    /// Failed to write to stdin.
    WriteFailed(io::Error),
    /// Failed to read from stdout.
    ReadFailed(io::Error),
    /// Command execution timed out.
    Timeout,
    /// Process crashed unexpectedly.
    ProcessCrashed(Option<i32>),
    /// Maximum restart attempts exceeded.
    MaxRestartsExceeded,
    /// The binary was not found.
    BinaryNotFound(String),
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFailed(e) => write!(f, "Failed to spawn link-cli process: {e}"),
            Self::NotRunning => write!(f, "Link-cli process is not running"),
            Self::WriteFailed(e) => write!(f, "Failed to write to link-cli stdin: {e}"),
            Self::ReadFailed(e) => write!(f, "Failed to read from link-cli stdout: {e}"),
            Self::Timeout => write!(f, "Command execution timed out"),
            Self::ProcessCrashed(code) => {
                if let Some(code) = code {
                    write!(f, "Link-cli process crashed with exit code {code}")
                } else {
                    write!(f, "Link-cli process crashed")
                }
            }
            Self::MaxRestartsExceeded => write!(f, "Maximum restart attempts exceeded"),
            Self::BinaryNotFound(path) => write!(f, "Link-cli binary not found: {path}"),
        }
    }
}

impl std::error::Error for ProcessError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::SpawnFailed(e) | Self::WriteFailed(e) | Self::ReadFailed(e) => Some(e),
            _ => None,
        }
    }
}

/// Result type for process operations.
pub type ProcessResult<T> = Result<T, ProcessError>;

// =============================================================================
// Process State
// =============================================================================

/// Internal state of a running process.
struct ProcessState {
    /// The child process handle.
    child: Child,
    /// Buffered reader for stdout.
    stdout_reader: BufReader<tokio::process::ChildStdout>,
    /// Writer for stdin.
    stdin_writer: tokio::process::ChildStdin,
}

// =============================================================================
// Link CLI Process
// =============================================================================

/// Manager for a link-cli child process.
///
/// Handles process lifecycle, command execution, and error recovery.
pub struct LinkCliProcess {
    /// Process configuration.
    config: ProcessConfig,
    /// Current process state (None if not running).
    state: Mutex<Option<ProcessState>>,
    /// Number of restart attempts.
    restart_count: Mutex<u32>,
}

impl LinkCliProcess {
    /// Creates a new process manager with the given configuration.
    ///
    /// # Arguments
    ///
    /// * `config` - Process configuration
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::backends::link_cli_process::{LinkCliProcess, ProcessConfig};
    ///
    /// let config = ProcessConfig::new("./data/db.links");
    /// let process = LinkCliProcess::new(config);
    /// ```
    #[must_use]
    pub fn new(config: ProcessConfig) -> Self {
        Self {
            config,
            state: Mutex::new(None),
            restart_count: Mutex::new(0),
        }
    }

    /// Checks if the process is currently running.
    pub async fn is_running(&self) -> bool {
        let state = self.state.lock().await;
        state.is_some()
    }

    /// Starts the link-cli process.
    ///
    /// # Errors
    ///
    /// Returns `ProcessError::SpawnFailed` if the process cannot be started.
    /// Returns `ProcessError::BinaryNotFound` if clink is not installed.
    #[allow(clippy::significant_drop_tightening)]
    pub async fn start(&self) -> ProcessResult<()> {
        let mut state = self.state.lock().await;

        // If already running, do nothing
        if state.is_some() {
            return Ok(());
        }

        let process_state = self.spawn_process()?;
        *state = Some(process_state);
        *self.restart_count.lock().await = 0;

        Ok(())
    }

    /// Spawns a new link-cli process.
    fn spawn_process(&self) -> ProcessResult<ProcessState> {
        let binary = self.config.binary();
        let db_path = self.config.db_path.to_string_lossy();

        let mut child = Command::new(binary)
            .arg("--db")
            .arg(db_path.as_ref())
            .arg("--interactive")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                if e.kind() == io::ErrorKind::NotFound {
                    ProcessError::BinaryNotFound(binary.to_string())
                } else {
                    ProcessError::SpawnFailed(e)
                }
            })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            ProcessError::SpawnFailed(io::Error::new(
                io::ErrorKind::Other,
                "Failed to capture stdin",
            ))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            ProcessError::SpawnFailed(io::Error::new(
                io::ErrorKind::Other,
                "Failed to capture stdout",
            ))
        })?;

        Ok(ProcessState {
            child,
            stdout_reader: BufReader::new(stdout),
            stdin_writer: stdin,
        })
    }

    /// Stops the link-cli process gracefully.
    ///
    /// # Errors
    ///
    /// Returns an error if the process cannot be stopped.
    #[allow(clippy::significant_drop_tightening)]
    pub async fn stop(&self) -> ProcessResult<()> {
        let mut state = self.state.lock().await;

        if let Some(mut process_state) = state.take() {
            // Try to kill gracefully
            let _ = process_state.child.kill().await;
        }

        Ok(())
    }

    /// Executes a command and returns the response.
    ///
    /// # Arguments
    ///
    /// * `command` - The Links Notation command to execute
    ///
    /// # Returns
    ///
    /// The response from link-cli (may be empty for some operations).
    ///
    /// # Errors
    ///
    /// Returns an error if the command fails or times out.
    pub async fn execute(&self, command: &str) -> ProcessResult<String> {
        self.execute_with_options(command, true).await
    }

    /// Executes a command with options.
    ///
    /// # Arguments
    ///
    /// * `command` - The Links Notation command to execute
    /// * `expect_response` - Whether to wait for a response
    #[allow(clippy::significant_drop_tightening)]
    async fn execute_with_options(
        &self,
        command: &str,
        expect_response: bool,
    ) -> ProcessResult<String> {
        let mut state_guard = self.state.lock().await;

        let state = state_guard.as_mut().ok_or(ProcessError::NotRunning)?;

        // Write command to stdin
        let cmd_with_newline = format!("{command}\n");
        state
            .stdin_writer
            .write_all(cmd_with_newline.as_bytes())
            .await
            .map_err(ProcessError::WriteFailed)?;

        state
            .stdin_writer
            .flush()
            .await
            .map_err(ProcessError::WriteFailed)?;

        if !expect_response {
            return Ok(String::new());
        }

        // Read response with timeout
        let timeout_duration = Duration::from_millis(self.config.command_timeout_ms);
        let mut response = String::new();

        match timeout(
            timeout_duration,
            state.stdout_reader.read_line(&mut response),
        )
        .await
        {
            Ok(Ok(_)) => Ok(response.trim().to_string()),
            Ok(Err(e)) => Err(ProcessError::ReadFailed(e)),
            Err(_) => Err(ProcessError::Timeout),
        }
    }

    /// Attempts to restart the process after a failure.
    ///
    /// # Errors
    ///
    /// Returns `ProcessError::MaxRestartsExceeded` if too many restarts.
    pub async fn try_restart(&self) -> ProcessResult<()> {
        if !self.config.auto_restart {
            return Err(ProcessError::NotRunning);
        }

        let mut count = self.restart_count.lock().await;
        if *count >= self.config.max_restart_attempts {
            return Err(ProcessError::MaxRestartsExceeded);
        }

        *count += 1;
        drop(count);

        // Stop existing process if any
        self.stop().await?;

        // Start new process
        self.start().await
    }

    /// Gets the current configuration.
    #[must_use]
    pub const fn config(&self) -> &ProcessConfig {
        &self.config
    }
}

impl Drop for LinkCliProcess {
    fn drop(&mut self) {
        // Best effort cleanup - can't await in drop
        if let Ok(mut state) = self.state.try_lock() {
            if let Some(mut process_state) = state.take() {
                // Try to kill the process synchronously
                let _ = process_state.child.start_kill();
            }
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod config_tests {
        use super::*;

        #[test]
        fn test_config_new() {
            let config = ProcessConfig::new("test.links");
            assert_eq!(config.db_path, PathBuf::from("test.links"));
            assert!(config.binary_path.is_none());
            assert_eq!(config.command_timeout_ms, 30_000);
            assert!(config.auto_restart);
        }

        #[test]
        fn test_config_builder() {
            let config = ProcessConfig::new("test.links")
                .with_binary_path("/usr/bin/clink")
                .with_timeout(5000)
                .with_auto_restart(false);

            assert_eq!(config.binary_path, Some(PathBuf::from("/usr/bin/clink")));
            assert_eq!(config.command_timeout_ms, 5000);
            assert!(!config.auto_restart);
        }

        #[test]
        fn test_config_default() {
            let config = ProcessConfig::default();
            assert_eq!(config.db_path, PathBuf::from("db.links"));
        }

        #[test]
        fn test_config_binary_default() {
            let config = ProcessConfig::new("test.links");
            assert_eq!(config.binary(), "clink");
        }

        #[test]
        fn test_config_binary_custom() {
            let config = ProcessConfig::new("test.links").with_binary_path("/custom/clink");
            assert_eq!(config.binary(), "/custom/clink");
        }
    }

    mod error_tests {
        use super::*;

        #[test]
        fn test_error_display() {
            let err = ProcessError::NotRunning;
            assert!(err.to_string().contains("not running"));

            let err = ProcessError::Timeout;
            assert!(err.to_string().contains("timed out"));

            let err = ProcessError::ProcessCrashed(Some(1));
            assert!(err.to_string().contains("exit code 1"));

            let err = ProcessError::BinaryNotFound("clink".to_string());
            assert!(err.to_string().contains("clink"));
        }
    }

    mod process_tests {
        use super::*;

        #[tokio::test]
        async fn test_process_new() {
            let config = ProcessConfig::new("test.links");
            let process = LinkCliProcess::new(config);
            assert!(!process.is_running().await);
        }

        #[tokio::test]
        async fn test_process_not_running_error() {
            let config = ProcessConfig::new("test.links");
            let process = LinkCliProcess::new(config);

            let result = process.execute("() ((1 2))").await;
            assert!(matches!(result, Err(ProcessError::NotRunning)));
        }

        #[tokio::test]
        async fn test_start_without_binary() {
            let config = ProcessConfig::new("test.links").with_binary_path("/nonexistent/clink");
            let process = LinkCliProcess::new(config);

            let result = process.start().await;
            assert!(result.is_err());
        }
    }
}
