---
status: accepted
---

# Keep one deep Materials module around one mutable Material

Materials owns one mutable Material and exposes the complete authoring and published-reading
boundary described here.

Platform exposes one deep `Materials` capability with caller-oriented `MaterialAuthoring` and
`PublishedMaterialReader` facets. Transport callers do not coordinate validation, rendering,
persistence or publication rules. Framework-agnostic `assembleMaterials` composition remains
available above the owners in `entrypoints/composition` for tests, seeds and non-Nest entrypoints.
Nest binds only facets with real production consumers. Products owns catalogue membership, explicit
programme placements, chapters, attachments, artifacts and archive facts in its own schema. Materials
emits its content/publication facts; process composition combines them with Products facts for access.
ContentAccess and sale availability are composed above the owners, so Materials does not assemble
Billing or concrete Account Rights. Content Covers owns the shared upload/reference/delete lifecycle;
each content owner selects its own cover through an interface. The retained Material-authoring surface
delegates Product commands to that owner and creates no second writable authority.

`MaterialBody` remains an internal validated representation. Public callers exchange the
serializable `MaterialBodySnapshot`; persisted data retains an explicit schema discriminator, and
version suffixes are limited to codecs and migrations. Runtime codecs validate public string IDs
at the module boundary and convert them to checked domain IDs. A separate public ContentSchema
capability was deferred until an independent caller proved the seam; [ADR 0023](0023-material-block-registry-package.md)
records that the seam is now proven and owns the block registry package.

The module owns one current mutable Material instead of an immutable revision lifecycle. A
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
