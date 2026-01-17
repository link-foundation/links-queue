//! Tests for cluster trait definitions.

use super::*;

mod node_status_tests {
    use super::*;

    #[test]
    fn test_node_status_display() {
        assert_eq!(format!("{}", NodeStatus::Healthy), "healthy");
        assert_eq!(format!("{}", NodeStatus::Suspect), "suspect");
        assert_eq!(format!("{}", NodeStatus::Dead), "dead");
        assert_eq!(format!("{}", NodeStatus::Joining), "joining");
        assert_eq!(format!("{}", NodeStatus::Leaving), "leaving");
    }

    #[test]
    fn test_node_status_default() {
        assert_eq!(NodeStatus::default(), NodeStatus::Joining);
    }
}

mod sync_mode_tests {
    use super::*;

    #[test]
    fn test_sync_mode_display() {
        assert_eq!(format!("{}", SyncMode::Sync), "sync");
        assert_eq!(format!("{}", SyncMode::Async), "async");
    }

    #[test]
    fn test_sync_mode_default() {
        assert_eq!(SyncMode::default(), SyncMode::Async);
    }
}

mod discovery_method_tests {
    use super::*;

    #[test]
    fn test_discovery_method_display() {
        assert_eq!(format!("{}", DiscoveryMethod::Static), "static");
        assert_eq!(format!("{}", DiscoveryMethod::Dns), "dns");
    }

    #[test]
    fn test_discovery_method_default() {
        assert_eq!(DiscoveryMethod::default(), DiscoveryMethod::Static);
    }
}

mod replication_config_tests {
    use super::*;

    #[test]
    fn test_replication_config_new() {
        let config = ReplicationConfig::new(3, true);
        assert_eq!(config.factor, 3);
        assert!(config.sync);
        assert!(config.min_replicas.is_none());
    }

    #[test]
    fn test_replication_config_with_min_replicas() {
        let config = ReplicationConfig::new(3, true).with_min_replicas(2);
        assert_eq!(config.min_replicas, Some(2));
        assert_eq!(config.min_replicas_or_default(), 2);
    }

    #[test]
    fn test_replication_config_default() {
        let config = ReplicationConfig::default();
        assert_eq!(config.factor, 1);
        assert!(!config.sync);
        assert_eq!(config.min_replicas_or_default(), 1);
    }
}

mod cluster_config_tests {
    use super::*;

    #[test]
    fn test_cluster_config_new() {
        let config = ClusterConfig::new(vec!["node1:5000".to_string()]);
        assert_eq!(config.nodes.len(), 1);
        assert_eq!(config.discovery, DiscoveryMethod::Static);
        assert!(config.replication.is_none());
    }

    #[test]
    fn test_cluster_config_builder() {
        let config = ClusterConfig::new(vec!["node1:5000".to_string()])
            .with_discovery(DiscoveryMethod::Dns)
            .with_replication(ReplicationConfig::new(3, true))
            .with_health_check_interval(10000)
            .with_health_check_timeout(2000)
            .with_suspect_threshold(5)
            .with_dead_threshold(10)
            .with_node_id("my-node".to_string())
            .with_advertise_address("192.168.1.1".to_string())
            .with_advertise_port(5001);

        assert_eq!(config.discovery, DiscoveryMethod::Dns);
        assert!(config.replication.is_some());
        assert_eq!(config.health_check_interval, 10000);
        assert_eq!(config.health_check_timeout, 2000);
        assert_eq!(config.suspect_threshold, 5);
        assert_eq!(config.dead_threshold, 10);
        assert_eq!(config.node_id, Some("my-node".to_string()));
        assert_eq!(config.advertise_address, Some("192.168.1.1".to_string()));
        assert_eq!(config.advertise_port, Some(5001));
    }

    #[test]
    fn test_cluster_config_default() {
        let config = ClusterConfig::default();
        assert!(config.nodes.is_empty());
        assert_eq!(config.health_check_interval, 5000);
        assert_eq!(config.health_check_timeout, 1000);
    }
}

mod cluster_stats_tests {
    use super::*;

    #[test]
    fn test_cluster_stats_new() {
        let stats = ClusterStats::new();
        assert_eq!(stats.total_nodes, 0);
        assert_eq!(stats.healthy_nodes, 0);
        assert!(!stats.is_leader);
    }
}

mod cluster_error_tests {
    use super::*;

    #[test]
    fn test_cluster_error_code_display() {
        assert_eq!(
            format!("{}", ClusterErrorCode::NotConnected),
            "NOT_CONNECTED"
        );
        assert_eq!(
            format!("{}", ClusterErrorCode::NetworkError),
            "NETWORK_ERROR"
        );
    }

    #[test]
    fn test_cluster_error_factories() {
        let err = ClusterError::not_connected();
        assert_eq!(err.code, ClusterErrorCode::NotConnected);

        let err = ClusterError::already_joined();
        assert_eq!(err.code, ClusterErrorCode::AlreadyJoined);

        let err = ClusterError::node_not_found("node-1");
        assert_eq!(err.code, ClusterErrorCode::NodeNotFound);
        assert!(err.message.contains("node-1"));

        let err = ClusterError::no_leader();
        assert_eq!(err.code, ClusterErrorCode::NoLeader);

        let err = ClusterError::replication_failed("not enough replicas");
        assert_eq!(err.code, ClusterErrorCode::ReplicationFailed);

        let err = ClusterError::network_error("connection refused");
        assert_eq!(err.code, ClusterErrorCode::NetworkError);

        let err = ClusterError::timeout("join");
        assert_eq!(err.code, ClusterErrorCode::Timeout);
    }

    #[test]
    fn test_cluster_error_display() {
        let err = ClusterError::not_connected();
        let display = format!("{err}");
        assert!(display.contains("NOT_CONNECTED"));
    }
}
