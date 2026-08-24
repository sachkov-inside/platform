---
status: accepted
---

# One deep Materials module with an internal versioned body schema

Platform exposes one `Materials` capability with two caller-oriented facets:
`MaterialAuthoring` for the editorial lifecycle and `PublishedMaterialReader` for exact published
delivery. One `createMaterials` assembly builds both facets; the Nest module only binds that runtime
to provider tokens. Transport callers do not coordinate validation, rendering, persistence or
publication rules themselves.

The current Nest adapter remains dynamically registered only while the real authorization owner
module does not exist. It must become a static module importing that provider with the first real
API/MCP consumer; creating a placeholder authorization module or global provider now would make
the graph look complete without a production policy.

`MaterialBody` is an internal validated representation. Public callers exchange a serializable
`MaterialBodySnapshot`; persisted data retains an explicit schema discriminator, and version
suffixes such as `StoredMaterialBodyV1` are limited to codecs and migrations. A separate public
`ContentSchema` capability is deferred until an independent caller proves that seam.

The implementation uses selective domain objects and TypeScript-native discriminated unions:
metadata and body values prevent invalid state, the immutable `Material` aggregate owns only draft
and publication transitions, and each operation exposes its actual error union. Kysely transactions
and semantic PostgreSQL helpers remain internal; generic repositories, Unit of Work wrappers,
command buses, base entities and one-interface-per-class are not part of the design.

Public command and response DTOs keep serializable string identifiers. Runtime codecs validate
them at the module boundary and convert them to branded `MaterialId` and `MaterialRevisionId`
inside domain and persistence code, avoiding both accidental ID mixing and caller-side casting.

This keeps the module deep and the public language stable, while accepting that a future second
consumer of the body schema may justify extraction. Such extraction must preserve the existing
Materials contract and is a new architectural decision, not a pre-built extension point.
