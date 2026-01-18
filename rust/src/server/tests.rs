//! Tests for the server module.

use super::*;

mod operation_tests {
    use crate::server::Operation;

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
    use crate::server::{Operation, Request};

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
    use crate::server::{LinkData, Response, ResponseData};

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

mod integration_tests {
    use super::*;
    use crate::server::{LinkData, Operation};
    use crate::MemoryQueueManager;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_router_ping() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager);

        let request = Request::ping();
        let response = router.route(&request).await;

        assert!(response.ok);
        assert!(response.to_json().contains("pong"));
    }

    #[tokio::test]
    async fn test_router_create_queue() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager);

        let request = Request::new(Operation::CreateQueue).with_queue("test-queue");
        let response = router.route(&request).await;

        assert!(response.ok);
        assert!(response.to_json().contains("test-queue"));
    }

    #[tokio::test]
    async fn test_router_list_queues() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager.clone());

        // Create a queue first
        let create_req = Request::new(Operation::CreateQueue).with_queue("queue1");
        router.route(&create_req).await;

        // List queues
        let list_req = Request::new(Operation::ListQueues);
        let response = router.route(&list_req).await;

        assert!(response.ok);
        assert!(response.to_json().contains("queue1"));
    }

    #[tokio::test]
    async fn test_router_enqueue_dequeue() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager.clone());

        // Create a queue
        let create_req = Request::new(Operation::CreateQueue).with_queue("tasks");
        router.route(&create_req).await;

        // Enqueue a link
        let enqueue_req = Request::new(Operation::Enqueue)
            .with_queue("tasks")
            .with_link(LinkData {
                id: 1,
                source: 2,
                target: 3,
                values: None,
            });
        let response = router.route(&enqueue_req).await;
        assert!(response.ok);

        // Dequeue the link
        let dequeue_req = Request::new(Operation::Dequeue).with_queue("tasks");
        let response = router.route(&dequeue_req).await;
        assert!(response.ok);

        let json = response.to_json();
        assert!(json.contains("\"source\":2"));
        assert!(json.contains("\"target\":3"));
    }

    #[tokio::test]
    async fn test_router_stats() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager.clone());

        // Create a queue
        let create_req = Request::new(Operation::CreateQueue).with_queue("stats-queue");
        router.route(&create_req).await;

        // Get stats
        let stats_req = Request::new(Operation::Stats).with_queue("stats-queue");
        let response = router.route(&stats_req).await;

        assert!(response.ok);
        let json = response.to_json();
        assert!(json.contains("depth"));
        assert!(json.contains("enqueued"));
    }

    #[tokio::test]
    async fn test_router_queue_not_found() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager);

        let request = Request::new(Operation::Dequeue).with_queue("nonexistent");
        let response = router.route(&request).await;

        assert!(!response.ok);
        assert!(response.to_json().contains("not found"));
    }

    #[tokio::test]
    async fn test_router_missing_queue_name() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager);

        let request = Request::new(Operation::Dequeue);
        let response = router.route(&request).await;

        assert!(!response.ok);
        assert!(response.to_json().contains("Missing queue"));
    }

    #[tokio::test]
    async fn test_router_delete_queue() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager.clone());

        // Create a queue
        let create_req = Request::new(Operation::CreateQueue).with_queue("to-delete");
        router.route(&create_req).await;

        // Delete it
        let delete_req = Request::new(Operation::DeleteQueue).with_queue("to-delete");
        let response = router.route(&delete_req).await;

        assert!(response.ok);
        assert!(response.to_json().contains("true"));

        // Verify it's gone
        let get_req = Request::new(Operation::GetQueue).with_queue("to-delete");
        let response = router.route(&get_req).await;
        assert!(!response.ok);
    }

    #[tokio::test]
    async fn test_router_peek() {
        let manager = Arc::new(MemoryQueueManager::<u64>::new());
        let router = Router::new(manager.clone());

        // Create a queue
        let create_req = Request::new(Operation::CreateQueue).with_queue("peek-queue");
        router.route(&create_req).await;

        // Enqueue a link
        let enqueue_req = Request::new(Operation::Enqueue)
            .with_queue("peek-queue")
            .with_link(LinkData {
                id: 1,
                source: 10,
                target: 20,
                values: None,
            });
        router.route(&enqueue_req).await;

        // Peek (should not remove)
        let peek_req = Request::new(Operation::Peek).with_queue("peek-queue");
        let response = router.route(&peek_req).await;
        assert!(response.ok);

        // Peek again (item should still be there)
        let response2 = router.route(&peek_req).await;
        assert!(response2.ok);
        assert!(response2.to_json().contains("\"source\":10"));
    }
}
