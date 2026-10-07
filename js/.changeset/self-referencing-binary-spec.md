---
'links-queue-js': patch
---

Correct the binary notation specification's self-referencing example to `0F 05 05` (3 bytes versus 8 text bytes, a 62.5% reduction). Clarify that the explicit ID and shared source/target reference are independent fields, and add specification and wire compatibility tests without changing the version 1.0 encoding.
