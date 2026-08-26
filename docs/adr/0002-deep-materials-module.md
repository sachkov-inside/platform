---
status: accepted
---

# One deep Materials module with an internal versioned body schema

Platform exposes one `Materials` capability with two caller-oriented facets:
`MaterialAuthoring` for the editorial lifecycle and `PublishedMaterialReader` for exact published
delivery. One framework-agnostic `assembleMaterials` function builds both facets for tests, seeds,
and non-Nest entrypoints; Nest binds only facets with real production consumers directly, as
described in ADR 0004. Transport callers do not coordinate validation, rendering, persistence or
publication rules themselves.

Dynamic Nest registration was a temporary bootstrap state, not part of the enduring Module
interface. Issue #49 implements the already accepted static-composition decision when it introduces
the first real API/MCP consumer; it does not reopen that decision. The first real authorization
owner replaces the approved anonymous/read-only baseline policy through an explicit Module import.
A placeholder authorization Module or global provider would make the graph look complete without a
production policy and remains forbidden.

`MaterialBody` is an internal validated representation. Public callers exchange a serializable
`MaterialBodySnapshot`; persisted data retains an explicit schema discriminator, and version
suffixes such as `StoredMaterialBodyV1` are limited to codecs and migrations. A separate public
`ContentSchema` capability is deferred until an independent caller proves that seam.

The implementation uses selective domain objects and TypeScript-native discriminated unions:
metadata and body values prevent invalid state, the immutable `Material` aggregate owns only draft
and publication transitions, and each operation exposes its actual error union. Prisma transaction
access follows ADR 0005; generic repositories, Unit of Work wrappers, command buses, base entities
and one-interface-per-class are not part of the design.

Public command and response DTOs keep serializable string identifiers. Runtime codecs validate
them at the module boundary and convert them to branded `MaterialId` and `MaterialRevisionId`
inside domain and persistence code, avoiding both accidental ID mixing and caller-side casting.

This keeps the module deep and the public language stable, while accepting that a future second
consumer of the body schema may justify extraction. Such extraction must preserve the existing
Materials contract and is a new architectural decision, not a pre-built extension point.
