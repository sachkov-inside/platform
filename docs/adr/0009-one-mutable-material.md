---
status: accepted
---

# Keep one deep Materials module around one mutable Material

This ADR supersedes ADR 0002 and restates all retained decisions so current guidance lives in one
place.

Platform exposes one deep `Materials` capability with caller-oriented `MaterialAuthoring` and
`PublishedMaterialReader` facets. Transport callers do not coordinate validation, rendering,
persistence or publication rules. Framework-agnostic `assembleMaterials` composition remains
available for tests, seeds and non-Nest entrypoints; Nest binds only facets with real production
consumers and imports the real Accounts, MembershipEntitlements and ContentAccess capabilities.

`MaterialBody` remains an internal validated representation. Public callers exchange the
serializable `MaterialBodySnapshot`; persisted data retains an explicit schema discriminator, and
version suffixes are limited to codecs and migrations. Runtime codecs validate public string IDs
at the module boundary and convert them to checked domain IDs. A separate public ContentSchema
capability is deferred until an independent caller proves the seam.

The module owns one current mutable Material instead of ADR 0002's immutable revision lifecycle. A
never-published Draft becomes Published through the same full-state Save used for later live edits;
Unpublished preserves the stable Material identity while hiding it. `contentVersion` rejects stale
saves and binds authorization to the current state, but old bodies, restore history and durable
mutation audit are deliberately absent.

This matches the owner-approved product workflow: saved edits to a Published Material are visible
immediately, a delegated agent with `materials:manage` may change content, access and publication
state, and recovery from a successful bad save is not a product capability. The trade-off accepts
irreversible author/agent mistakes in exchange for removing parallel draft/published content,
revision selection, restore and multi-body delivery.

## Consequences

- Draft, Published and Unpublished are Material states; only a never-published Draft can be deleted.
- Slug becomes immutable on first publication. Entering Published sets `publishedAt`; ordinary live
  saves do not reorder the Material as a new publication.
- One full-state Save validates and atomically updates body, metadata, access and publication state
  against `expectedContentVersion`; stale writes fail without changing the Material.
- Public/search projections and cache invalidation belong to the same successful Save.
- `ContentAccess` authorizes `MaterialId`; a conditional body load requires the accepted
  `contentVersion` to remain current.
- Prisma transaction access follows ADR 0005. Generic repositories, Unit of Work wrappers, command
  buses, base entities and one-interface-per-class are not part of the design.

ADR 0002 remains historical evidence only. It is not a second current source for Materials design.
