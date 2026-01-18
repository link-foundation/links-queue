---
'links-queue-js': minor
---

Add TCP server mode for Links Queue

- Implement LinksQueueServer with TCP socket support
- Implement LinksQueueClient for connecting to TCP servers
- Add CLI command for starting server: `links-queue server`
- Support all queue operations over TCP: push, pop, peek, list, delete, getStats
- Add connection management with idle timeout and max connections
- Add graceful shutdown with connection draining
