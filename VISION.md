# Links Queue Vision

## The Core Idea

Links Queue is a universal queue system that works with **links** instead of traditional messages, events, or tasks. Each queue item is represented as one link, which is actually a sequence of links using Links Notation.

## Why Links?

Traditional message queues work with:
- **Messages**: Arbitrary bytes or JSON blobs
- **Events**: Structured data with types and payloads
- **Tasks**: Function calls with serialized arguments

Links Queue works with **links**—the most fundamental unit of information, represented as ordered pairs of (source, target). This approach offers:

1. **Universal Data Model**: Any message, event, or task can be represented as links
2. **Graph-Native Operations**: Natural support for relationships and dependencies
3. **Deduplication by Design**: Identical link structures are automatically recognized
4. **Self-Describing Data**: Links can reference themselves and other links

## Operating Modes

Links Queue scales from simple to complex by configuration alone:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Scaling Through Configuration                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Single Node                                                         │
│  ├── In-Memory Only          Fastest, no persistence               │
│  └── Stored (link-cli)       Persisted to local SQLite              │
│                                                                      │
│  Multiple Nodes                                                      │
│  ├── Memory Only             Distributed, no persistence            │
│  └── Stored                  Distributed with persistence           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

The same code works across all modes—only the configuration changes.

## Deployment Flexibility

Links Queue adapts to your architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Deployment Options                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Embedded Library                                                    │
│  ┌─────────────────────┐                                            │
│  │    Application      │  Direct function calls                     │
│  │  ┌───────────────┐  │  Minimal latency                          │
│  │  │ links-queue   │  │  No network overhead                      │
│  │  └───────────────┘  │                                            │
│  └─────────────────────┘                                            │
│                                                                      │
│  Separate Server                                                     │
│  ┌──────────┐    Links Notation    ┌───────────────┐               │
│  │   App    │◄───────────────────► │ links-queue   │               │
│  └──────────┘                      │    server     │               │
│                                    └───────────────┘               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Exchange Protocol

### Links Notation (Text)

For human readability and debugging, Links Queue uses text-based Links Notation:

```
((source target) (another_source another_target))
```

This notation enables:
- Easy inspection and debugging
- Version control friendly
- Cross-language compatibility

### Binary Links Notation (Future)

For performance-critical applications, a binary protocol will be developed with:
- Compact representation
- Zero-copy parsing where possible
- Backward compatibility with text notation

## Competitive Position

Links Queue aims to combine the best features of existing solutions:

| From | We Take |
|------|---------|
| Redis/BullMQ | Sub-millisecond latency, simplicity |
| RabbitMQ | Flexible routing, reliability guarantees |
| Apache Kafka | Horizontal scaling, event replay |
| Celery | Task workflows, scheduling |

While adding unique capabilities:
- **Universal link-based data model**
- **Zero-config quick start to distributed deployment**
- **Replaceable storage backends**
- **Native support for graph operations**

## Target Users

1. **Developers building with link-foundation ecosystem**: Native integration with link-cli and other tools

2. **Applications needing simple to complex scaling**: Start embedded, grow to distributed without code changes

3. **Teams wanting customizable storage**: Experiment with different backends (memory, SQLite, custom)

4. **Projects requiring semantic data relationships**: When your data naturally forms a graph

## Success Criteria

Links Queue succeeds when:
- A developer can add queue functionality in under 5 minutes
- The same code runs single-node and distributed
- Performance matches or exceeds BullMQ for common operations
- Any storage backend can be plugged in without core changes
- The system is understandable from source code alone
