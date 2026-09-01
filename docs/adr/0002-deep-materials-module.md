---
status: accepted
---

# One deep Materials module with an internal versioned body schema

ADR 0009 supersedes the original immutable revision lifecycle. The retained decision is the deep
Materials module, its internal body schema and caller-oriented facets. Current Material lifecycle
and persistence decisions come from ADR 0009; this ADR must not be used to reintroduce revisions,
restore, or draft/published pointers.

Platform exposes one `Materials` capability with two caller-oriented facets:
`MaterialAuthoring` for the editorial lifecycle and `PublishedMaterialReader` for exact published
delivery. One framework-agnostic `assembleMaterials` function builds both facets for tests, seeds,
and non-Nest entrypoints; Nest binds only facets with real production consumers directly, as
described in ADR 0004. Transport callers do not coordinate validation, rendering, persistence or
publication rules themselves.

Nest production composition imports the real Accounts, MembershipEntitlements and ContentAccess
capabilities. `assembleMaterials` remains the framework-agnostic composition seam for tests, seeds
and non-Nest entrypoints. A placeholder authorization Module or global provider that bypasses those
capability interfaces remains forbidden.

`MaterialBody` is an internal validated representation. Public callers exchange a serializable
`MaterialBodySnapshot`; persisted data retains an explicit schema discriminator, and version
suffixes such as `StoredMaterialBodyV1` are limited to codecs and migrations. A separate public
`ContentSchema` capability is deferred until an independent caller proves that seam.

The implementation uses selective domain objects and TypeScript-native discriminated unions:
metadata and body values prevent invalid state, one mutable `Material` owns its current publication
state and content version, and each operation exposes its actual error union. Prisma transaction
access follows ADR 0005; generic repositories, Unit of Work wrappers, command buses, base entities
and one-interface-per-class are not part of the design.

Public command and response DTOs keep serializable string identifiers. Runtime codecs validate
them at the module boundary and convert them to checked `MaterialId` values inside domain and
persistence code, avoiding both invalid identifiers and caller-side casting.

This keeps the module deep and the public language stable, while accepting that a future second
consumer of the body schema may justify extraction. Such extraction must preserve the existing
Materials contract and is a new architectural decision, not a pre-built extension point.
