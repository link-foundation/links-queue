---
'links-queue-js': minor
---

Integrate links-notation library for parsing and serialization

- Add `links-notation` as a production dependency
- Add `LinksNotation` class with `parse()` and `stringify()` methods
- Add `NotationParser` for custom parser configurations
- Add `NotationStreamParser` for streaming large inputs
- Add `NotationParseError` for detailed parse error information
- Add protocol message types (`RequestType`, `ResponseStatus`, `ErrorCode`)
- Add `Message` and `MessageBuilder` classes for protocol communication
- Add helper functions for creating request/response messages
- Full TypeScript type definitions for all new exports
- Comprehensive unit tests for parsing, serialization, and messages
