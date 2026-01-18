//! Gossip protocol for cluster membership.
//!
//! This module implements a gossip-based protocol for maintaining cluster
//! membership information. Nodes periodically exchange state information
//! with random peers to propagate membership changes efficiently.

// Allow intentional casts for timestamp conversions and holding locks across iterations.
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::significant_drop_tightening)]
#![allow(clippy::significant_drop_in_scrutinee)]
#![allow(clippy::missing_fields_in_debug)]
#![allow(clippy::match_wildcard_for_single_variants)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;

use super::node::Node;
use super::traits::{ClusterError, ClusterEvent, ClusterNode, NodeStatus};

// =============================================================================
// Gossip Configuration
// =============================================================================

/// Configuration for the gossip protocol.
#[derive(Debug, Clone)]
pub struct GossipConfig {
    /// Interval between gossip rounds (in milliseconds).
    pub gossip_interval: u64,

    /// Number of nodes to gossip with per round.
    pub fanout: usize,

    /// Timeout for gossip messages (in milliseconds).
    pub gossip_timeout: u64,

    /// Port to listen on for gossip messages.
    pub port: u16,

    /// Maximum message size in bytes.
    pub max_message_size: usize,
}

impl Default for GossipConfig {
    fn default() -> Self {
        Self {
            gossip_interval: 1000,
            fanout: 3,
            gossip_timeout: 500,
            port: 5001,
            max_message_size: 65536,
        }
    }
}

impl GossipConfig {
    /// Creates a new gossip configuration.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            gossip_interval: 1000,
            fanout: 3,
            gossip_timeout: 500,
            port: 5001,
            max_message_size: 65536,
        }
    }

    /// Sets the gossip interval.
    #[must_use]
    pub const fn with_gossip_interval(mut self, interval: u64) -> Self {
        self.gossip_interval = interval;
        self
    }

    /// Sets the fanout.
    #[must_use]
    pub const fn with_fanout(mut self, fanout: usize) -> Self {
        self.fanout = fanout;
        self
    }

    /// Sets the gossip timeout.
    #[must_use]
    pub const fn with_gossip_timeout(mut self, timeout: u64) -> Self {
        self.gossip_timeout = timeout;
        self
    }

    /// Sets the gossip port.
    #[must_use]
    pub const fn with_port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }
}

// =============================================================================
// Member State
// =============================================================================

/// The state of a cluster member as known by gossip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberState {
    /// Node ID.
    pub node_id: String,

    /// Node address.
    pub address: String,

    /// Node port.
    pub port: u16,

    /// Current status.
    pub status: NodeStatus,

    /// Incarnation number (monotonically increasing version).
    pub incarnation: u64,

    /// Timestamp of last update.
    pub timestamp: u64,

    /// Metadata as key-value pairs.
    pub metadata: HashMap<String, String>,
}

impl MemberState {
    /// Creates a new member state.
    #[must_use]
    pub fn new(node_id: String, address: String, port: u16) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Self {
            node_id,
            address,
            port,
            status: NodeStatus::Joining,
            incarnation: 0,
            timestamp,
            metadata: HashMap::new(),
        }
    }

    /// Creates a member state from a node.
    #[must_use]
    pub fn from_node(node: &Node) -> Self {
        Self::new(
            node.id().to_string(),
            node.address().to_string(),
            node.port(),
        )
    }

    /// Updates the status and increments incarnation.
    pub fn update_status(&mut self, status: NodeStatus) {
        self.status = status;
        self.incarnation += 1;
        self.timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
    }

    /// Merges another member state if it's more recent.
    ///
    /// Returns true if this state was updated.
    pub fn merge(&mut self, other: &Self) -> bool {
        if other.incarnation > self.incarnation {
            self.status = other.status;
            self.incarnation = other.incarnation;
            self.timestamp = other.timestamp;
            self.metadata.clone_from(&other.metadata);
            true
        } else {
            false
        }
    }

    /// Serializes the member state to a string.
    #[must_use]
    pub fn serialize(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}|{}",
            self.node_id, self.address, self.port, self.status, self.incarnation, self.timestamp
        )
    }

    /// Deserializes a member state from a string.
    #[must_use]
    pub fn deserialize(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.split('|').collect();
        if parts.len() < 6 {
            return None;
        }

        let status = match parts[3] {
            "healthy" => NodeStatus::Healthy,
            "suspect" => NodeStatus::Suspect,
            "dead" => NodeStatus::Dead,
            "joining" => NodeStatus::Joining,
            "leaving" => NodeStatus::Leaving,
            _ => return None,
        };

        Some(Self {
            node_id: parts[0].to_string(),
            address: parts[1].to_string(),
            port: parts[2].parse().ok()?,
            status,
            incarnation: parts[4].parse().ok()?,
            timestamp: parts[5].parse().ok()?,
            metadata: HashMap::new(),
        })
    }
}

// =============================================================================
// Gossip Message
// =============================================================================

/// Types of gossip messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GossipMessageType {
    /// Ping - request for acknowledgment.
    Ping,
    /// Pong - acknowledgment of ping.
    Pong,
    /// Full state sync request.
    SyncRequest,
    /// Full state sync response.
    SyncResponse,
    /// Incremental update.
    Update,
}

impl std::fmt::Display for GossipMessageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ping => write!(f, "PING"),
            Self::Pong => write!(f, "PONG"),
            Self::SyncRequest => write!(f, "SYNC_REQ"),
            Self::SyncResponse => write!(f, "SYNC_RSP"),
            Self::Update => write!(f, "UPDATE"),
        }
    }
}

/// A gossip protocol message.
#[derive(Debug, Clone)]
pub struct GossipMessage {
    /// Message type.
    pub msg_type: GossipMessageType,

    /// Sender node ID.
    pub sender_id: String,

    /// Sequence number for ordering.
    pub sequence: u64,

    /// Member states included in the message.
    pub members: Vec<MemberState>,
}

impl GossipMessage {
    /// Creates a new gossip message.
    #[must_use]
    pub const fn new(msg_type: GossipMessageType, sender_id: String) -> Self {
        Self {
            msg_type,
            sender_id,
            sequence: 0,
            members: Vec::new(),
        }
    }

    /// Creates a ping message.
    #[must_use]
    pub const fn ping(sender_id: String) -> Self {
        Self::new(GossipMessageType::Ping, sender_id)
    }

    /// Creates a pong message.
    #[must_use]
    pub const fn pong(sender_id: String) -> Self {
        Self::new(GossipMessageType::Pong, sender_id)
    }

    /// Creates a sync request message.
    #[must_use]
    pub const fn sync_request(sender_id: String) -> Self {
        Self::new(GossipMessageType::SyncRequest, sender_id)
    }

    /// Creates a sync response message.
    #[must_use]
    pub fn sync_response(sender_id: String, members: Vec<MemberState>) -> Self {
        let mut msg = Self::new(GossipMessageType::SyncResponse, sender_id);
        msg.members = members;
        msg
    }

    /// Creates an update message.
    #[must_use]
    pub fn update(sender_id: String, members: Vec<MemberState>) -> Self {
        let mut msg = Self::new(GossipMessageType::Update, sender_id);
        msg.members = members;
        msg
    }

    /// Serializes the message to bytes.
    #[must_use]
    pub fn serialize(&self) -> Vec<u8> {
        let mut lines = vec![format!(
            "{}|{}|{}",
            self.msg_type, self.sender_id, self.sequence
        )];

        for member in &self.members {
            lines.push(member.serialize());
        }

        lines.join("\n").into_bytes()
    }

    /// Deserializes a message from bytes.
    #[must_use]
    pub fn deserialize(data: &[u8]) -> Option<Self> {
        let text = String::from_utf8_lossy(data);
        let mut lines = text.lines();

        // Parse header
        let header = lines.next()?;
        let parts: Vec<&str> = header.split('|').collect();
        if parts.len() < 3 {
            return None;
        }

        let msg_type = match parts[0] {
            "PING" => GossipMessageType::Ping,
            "PONG" => GossipMessageType::Pong,
            "SYNC_REQ" => GossipMessageType::SyncRequest,
            "SYNC_RSP" => GossipMessageType::SyncResponse,
            "UPDATE" => GossipMessageType::Update,
            _ => return None,
        };

        let mut msg = Self::new(msg_type, parts[1].to_string());
        msg.sequence = parts[2].parse().ok()?;

        // Parse member states
        for line in lines {
            if let Some(member) = MemberState::deserialize(line) {
                msg.members.push(member);
            }
        }

        Some(msg)
    }
}

// =============================================================================
// Gossip Protocol
// =============================================================================

/// Gossip protocol implementation.
///
/// Handles membership dissemination using a push-pull gossip mechanism.
pub struct GossipProtocol {
    /// Configuration.
    config: GossipConfig,

    /// Local node information.
    local_node: Arc<Node>,

    /// Known member states.
    members: Arc<RwLock<HashMap<String, MemberState>>>,

    /// Event sender.
    event_tx: broadcast::Sender<ClusterEvent<Node>>,

    /// Running state.
    running: AtomicBool,

    /// Sequence counter.
    sequence: Arc<AtomicU64>,

    /// Handle to the listener task.
    listener_handle: RwLock<Option<JoinHandle<()>>>,

    /// Handle to the gossip task.
    gossip_handle: RwLock<Option<JoinHandle<()>>>,

    /// Statistics.
    stats: GossipStats,
}

impl GossipProtocol {
    /// Creates a new gossip protocol instance.
    #[must_use]
    pub fn new(config: GossipConfig, local_node: Node) -> Self {
        let (event_tx, _) = broadcast::channel(256);

        // Add local node to members
        let local_state = MemberState::from_node(&local_node);

        let mut members = HashMap::new();
        members.insert(local_node.id().to_string(), local_state);

        Self {
            config,
            local_node: Arc::new(local_node),
            members: Arc::new(RwLock::new(members)),
            event_tx,
            running: AtomicBool::new(false),
            sequence: Arc::new(AtomicU64::new(0)),
            listener_handle: RwLock::new(None),
            gossip_handle: RwLock::new(None),
            stats: GossipStats::default(),
        }
    }

    /// Starts the gossip protocol.
    pub async fn start(&self) -> Result<(), ClusterError> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(ClusterError::already_joined());
        }

        // Mark local node as healthy
        self.update_local_status(NodeStatus::Healthy).await;

        // Start listener
        self.start_listener().await?;

        // Start gossip loop
        self.start_gossip_loop().await;

        Ok(())
    }

    /// Stops the gossip protocol.
    pub async fn stop(&self) {
        // Mark as leaving
        self.update_local_status(NodeStatus::Leaving).await;

        // Brief delay to propagate leaving status
        tokio::time::sleep(Duration::from_millis(100)).await;

        self.running.store(false, Ordering::SeqCst);

        // Stop tasks
        if let Some(handle) = self.listener_handle.write().await.take() {
            handle.abort();
        }
        if let Some(handle) = self.gossip_handle.write().await.take() {
            handle.abort();
        }
    }

    /// Returns whether the protocol is running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Adds a seed node to bootstrap from.
    pub async fn add_seed(&self, address: &str) -> Result<(), ClusterError> {
        let node = Node::from_addr(address)?;
        let state = MemberState::from_node(&node);

        let mut members = self.members.write().await;
        members.insert(state.node_id.clone(), state);

        Ok(())
    }

    /// Returns all known members.
    pub async fn get_members(&self) -> Vec<MemberState> {
        let members = self.members.read().await;
        members.values().cloned().collect()
    }

    /// Returns healthy members.
    pub async fn get_healthy_members(&self) -> Vec<MemberState> {
        let members = self.members.read().await;
        members
            .values()
            .filter(|m| m.status == NodeStatus::Healthy)
            .cloned()
            .collect()
    }

    /// Updates local node status.
    async fn update_local_status(&self, status: NodeStatus) {
        let mut members = self.members.write().await;
        if let Some(local) = members.get_mut(self.local_node.id()) {
            local.update_status(status);
        }
    }

    /// Starts the TCP listener for incoming gossip messages.
    async fn start_listener(&self) -> Result<(), ClusterError> {
        let addr = format!("0.0.0.0:{}", self.config.port);
        let listener = TcpListener::bind(&addr)
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        let members = Arc::clone(&self.members);
        let event_tx = self.event_tx.clone();
        let local_id = self.local_node.id().to_string();
        let stats = self.stats.clone();
        let running = self.running.load(Ordering::SeqCst);

        if !running {
            return Ok(());
        }

        let handle = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let members = Arc::clone(&members);
                        let event_tx = event_tx.clone();
                        let local_id = local_id.clone();
                        let stats = stats.clone();

                        tokio::spawn(async move {
                            if let Err(e) =
                                Self::handle_connection(stream, members, event_tx, &local_id, stats)
                                    .await
                            {
                                // Log error in production
                                let _ = e;
                            }
                        });
                    }
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        });

        *self.listener_handle.write().await = Some(handle);
        Ok(())
    }

    /// Handles an incoming gossip connection.
    async fn handle_connection(
        mut stream: TcpStream,
        members: Arc<RwLock<HashMap<String, MemberState>>>,
        event_tx: broadcast::Sender<ClusterEvent<Node>>,
        local_id: &str,
        stats: GossipStats,
    ) -> Result<(), ClusterError> {
        // Read message
        let mut buf = vec![0u8; 65536];
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        if n == 0 {
            return Ok(());
        }

        stats.messages_received.fetch_add(1, Ordering::SeqCst);

        let msg = GossipMessage::deserialize(&buf[..n])
            .ok_or_else(|| ClusterError::network_error("Invalid message"))?;

        // Process message based on type
        let response = match msg.msg_type {
            GossipMessageType::Ping => Some(GossipMessage::pong(local_id.to_string())),
            GossipMessageType::SyncRequest => {
                let all_members: Vec<MemberState> = {
                    let m = members.read().await;
                    m.values().cloned().collect()
                };
                Some(GossipMessage::sync_response(
                    local_id.to_string(),
                    all_members,
                ))
            }
            GossipMessageType::Update | GossipMessageType::SyncResponse => {
                // Merge member states
                let mut m = members.write().await;
                for member in msg.members {
                    if let Some(existing) = m.get_mut(&member.node_id) {
                        if existing.merge(&member) {
                            // State changed, emit event
                            let node = Node::new(&member.node_id, &member.address, member.port);
                            match member.status {
                                NodeStatus::Healthy => {
                                    let _ = event_tx.send(ClusterEvent::NodeJoined(node));
                                }
                                NodeStatus::Dead | NodeStatus::Leaving => {
                                    let _ = event_tx.send(ClusterEvent::NodeLeft(node));
                                }
                                NodeStatus::Suspect => {
                                    let _ = event_tx.send(ClusterEvent::NodeSuspect(node));
                                }
                                _ => {}
                            }
                        }
                    } else {
                        // New member
                        let node = Node::new(&member.node_id, &member.address, member.port);
                        let _ = event_tx.send(ClusterEvent::NodeJoined(node));
                        m.insert(member.node_id.clone(), member);
                    }
                }
                None
            }
            GossipMessageType::Pong => None,
        };

        // Send response if needed
        if let Some(resp) = response {
            let data = resp.serialize();
            stream
                .write_all(&data)
                .await
                .map_err(|e| ClusterError::network_error(&e.to_string()))?;
            stats.messages_sent.fetch_add(1, Ordering::SeqCst);
        }

        Ok(())
    }

    /// Starts the periodic gossip loop.
    async fn start_gossip_loop(&self) {
        let config = self.config.clone();
        let members = Arc::clone(&self.members);
        let local_id = self.local_node.id().to_string();
        let sequence = Arc::clone(&self.sequence);
        let stats = self.stats.clone();
        let running = self.running.load(Ordering::SeqCst);

        if !running {
            return;
        }

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(config.gossip_interval));

            loop {
                interval.tick().await;

                // Select random peers
                let peers: Vec<MemberState> = {
                    let m = members.read().await;
                    m.values()
                        .filter(|p| p.node_id != local_id && p.status != NodeStatus::Dead)
                        .take(config.fanout)
                        .cloned()
                        .collect()
                };

                // Gossip with each peer
                for peer in peers {
                    let seq = sequence.fetch_add(1, Ordering::SeqCst);
                    let local_members: Vec<MemberState> = {
                        let m = members.read().await;
                        m.values().cloned().collect()
                    };

                    let mut msg = GossipMessage::update(local_id.clone(), local_members);
                    msg.sequence = seq;

                    let addr = format!("{}:{}", peer.address, peer.port);
                    match Self::send_gossip(&addr, msg, config.gossip_timeout).await {
                        Ok(_) => {
                            stats.messages_sent.fetch_add(1, Ordering::SeqCst);
                        }
                        Err(_) => {
                            stats.messages_failed.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                }
            }
        });

        *self.gossip_handle.write().await = Some(handle);
    }

    /// Sends a gossip message to a peer.
    async fn send_gossip(
        addr: &str,
        msg: GossipMessage,
        timeout_ms: u64,
    ) -> Result<Option<GossipMessage>, ClusterError> {
        let timeout = Duration::from_millis(timeout_ms);

        let stream = tokio::time::timeout(timeout, TcpStream::connect(addr))
            .await
            .map_err(|_| ClusterError::timeout("connect"))?
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        let (mut reader, mut writer) = stream.into_split();

        // Send message
        let data = msg.serialize();
        tokio::time::timeout(timeout, writer.write_all(&data))
            .await
            .map_err(|_| ClusterError::timeout("write"))?
            .map_err(|e| ClusterError::network_error(&e.to_string()))?;

        // Read response (if any)
        let mut buf = vec![0u8; 65536];
        match tokio::time::timeout(timeout, reader.read(&mut buf)).await {
            Ok(Ok(n)) if n > 0 => Ok(GossipMessage::deserialize(&buf[..n])),
            _ => Ok(None),
        }
    }

    /// Returns a subscription to cluster events.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<ClusterEvent<Node>> {
        self.event_tx.subscribe()
    }

    /// Returns gossip statistics.
    #[must_use]
    pub const fn stats(&self) -> &GossipStats {
        &self.stats
    }
}

impl std::fmt::Debug for GossipProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GossipProtocol")
            .field("config", &self.config)
            .field("local_node", &self.local_node)
            .field("running", &self.running)
            .finish()
    }
}

// =============================================================================
// Gossip Statistics
// =============================================================================

/// Statistics about gossip protocol operations.
#[derive(Debug, Default, Clone)]
pub struct GossipStats {
    /// Number of messages sent.
    pub messages_sent: Arc<AtomicU64>,
    /// Number of messages received.
    pub messages_received: Arc<AtomicU64>,
    /// Number of failed message sends.
    pub messages_failed: Arc<AtomicU64>,
    /// Number of state changes propagated.
    pub state_changes: Arc<AtomicU64>,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod gossip_config_tests {
        use super::*;

        #[test]
        fn test_config_default() {
            let config = GossipConfig::default();
            assert_eq!(config.gossip_interval, 1000);
            assert_eq!(config.fanout, 3);
        }

        #[test]
        fn test_config_builder() {
            let config = GossipConfig::new()
                .with_gossip_interval(500)
                .with_fanout(5)
                .with_port(6000);

            assert_eq!(config.gossip_interval, 500);
            assert_eq!(config.fanout, 5);
            assert_eq!(config.port, 6000);
        }
    }

    mod member_state_tests {
        use super::*;

        #[test]
        fn test_member_state_new() {
            let state = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);
            assert_eq!(state.node_id, "node-1");
            assert_eq!(state.address, "127.0.0.1");
            assert_eq!(state.port, 5000);
            assert_eq!(state.status, NodeStatus::Joining);
            assert_eq!(state.incarnation, 0);
        }

        #[test]
        fn test_member_state_update_status() {
            let mut state = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);

            state.update_status(NodeStatus::Healthy);
            assert_eq!(state.status, NodeStatus::Healthy);
            assert_eq!(state.incarnation, 1);

            state.update_status(NodeStatus::Suspect);
            assert_eq!(state.status, NodeStatus::Suspect);
            assert_eq!(state.incarnation, 2);
        }

        #[test]
        fn test_member_state_merge() {
            let mut state1 = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);

            let mut state2 = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);
            state2.incarnation = 5;
            state2.status = NodeStatus::Healthy;

            assert!(state1.merge(&state2));
            assert_eq!(state1.incarnation, 5);
            assert_eq!(state1.status, NodeStatus::Healthy);
        }

        #[test]
        fn test_member_state_merge_older() {
            let mut state1 = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);
            state1.incarnation = 10;

            let state2 = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);

            assert!(!state1.merge(&state2));
            assert_eq!(state1.incarnation, 10);
        }

        #[test]
        fn test_member_state_serialize_deserialize() {
            let mut state = MemberState::new("node-1".to_string(), "127.0.0.1".to_string(), 5000);
            state.status = NodeStatus::Healthy;
            state.incarnation = 5;

            let serialized = state.serialize();
            let deserialized = MemberState::deserialize(&serialized).unwrap();

            assert_eq!(deserialized.node_id, state.node_id);
            assert_eq!(deserialized.address, state.address);
            assert_eq!(deserialized.port, state.port);
            assert_eq!(deserialized.status, state.status);
            assert_eq!(deserialized.incarnation, state.incarnation);
        }
    }

    mod gossip_message_tests {
        use super::*;

        #[test]
        fn test_message_ping() {
            let msg = GossipMessage::ping("node-1".to_string());
            assert_eq!(msg.msg_type, GossipMessageType::Ping);
            assert_eq!(msg.sender_id, "node-1");
        }

        #[test]
        fn test_message_pong() {
            let msg = GossipMessage::pong("node-1".to_string());
            assert_eq!(msg.msg_type, GossipMessageType::Pong);
        }

        #[test]
        fn test_message_serialize_deserialize() {
            let mut msg = GossipMessage::update("node-1".to_string(), vec![]);
            msg.sequence = 42;
            msg.members.push(MemberState::new(
                "node-2".to_string(),
                "127.0.0.1".to_string(),
                5000,
            ));

            let data = msg.serialize();
            let parsed = GossipMessage::deserialize(&data).unwrap();

            assert_eq!(parsed.msg_type, GossipMessageType::Update);
            assert_eq!(parsed.sender_id, "node-1");
            assert_eq!(parsed.sequence, 42);
            assert_eq!(parsed.members.len(), 1);
        }
    }

    mod gossip_protocol_tests {
        use super::*;

        fn create_test_protocol() -> GossipProtocol {
            let config = GossipConfig::new().with_port(0); // Random port
            let node = Node::new("local", "127.0.0.1", 5000);
            GossipProtocol::new(config, node)
        }

        #[test]
        fn test_protocol_new() {
            let protocol = create_test_protocol();
            assert!(!protocol.is_running());
        }

        #[tokio::test]
        async fn test_protocol_get_members() {
            let protocol = create_test_protocol();
            let members = protocol.get_members().await;
            assert_eq!(members.len(), 1); // Just local node
        }

        #[tokio::test]
        async fn test_protocol_add_seed() {
            let protocol = create_test_protocol();
            protocol.add_seed("192.168.1.1:5000").await.unwrap();

            let members = protocol.get_members().await;
            assert_eq!(members.len(), 2);
        }

        #[tokio::test]
        async fn test_protocol_subscribe() {
            let protocol = create_test_protocol();
            let _rx = protocol.subscribe();
        }
    }

    mod gossip_stats_tests {
        use super::*;

        #[test]
        fn test_stats_default() {
            let stats = GossipStats::default();
            assert_eq!(stats.messages_sent.load(Ordering::SeqCst), 0);
            assert_eq!(stats.messages_received.load(Ordering::SeqCst), 0);
            assert_eq!(stats.messages_failed.load(Ordering::SeqCst), 0);
        }
    }
}
