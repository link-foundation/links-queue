---
'links-queue-js': minor
---

Add Binary Links Notation protocol for efficient link serialization

- Implement binary encoder/decoder with 20-40% size reduction over text notation
- Add LEB128 variable-length integer encoding for compact numeric values
- Support nested links, self-references, and typed values (null, boolean, string, integer)
- Add protocol negotiation mechanism for client-server capability exchange
- Include comprehensive benchmark tests comparing binary vs text performance
