//! Tests for the server module.

use super::*;

mod integration_tests {
    use super::*;
    use crate::MemoryQueueManager;
    use crate::server::{LinkData, Operation};
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
