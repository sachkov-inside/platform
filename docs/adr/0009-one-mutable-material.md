---
status: accepted
---

# Keep one deep Materials module around one mutable Material

Platform keeps one deep `Materials` module but replaces the immutable `MaterialRevision` lifecycle
from ADR 0002 with one current mutable Material. A never-published Draft becomes Published through
the same full-state Save used for later live edits; Unpublished preserves the stable Material
identity while hiding it. `contentVersion` rejects stale saves and binds authorization to the
current state, but old bodies, restore history and durable mutation audit are deliberately absent.

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

ADR 0002 remains historical evidence for the retained deep-module and internal body-schema choices,
but its immutable aggregate/revision identifier and publication-pointer decisions are superseded.
