---
status: accepted
---

# Use one public ContentLibrary read model with aggregate-owned covers

Home, Library, Topic and Product discovery consume one body-free `ContentLibrary` projection of
current Published Materials instead of maintaining frontend fixtures or page-specific content
stores. A Content Cover belongs to exactly one Material, Topic or Product and crosses the public
boundary only as normalized responsive renditions; original uploads, storage keys and checksums
remain private. This keeps every public surface and its Storybook proof on the same real-data
contract while allowing the backend to enforce publication and access policy once. The trade-off is
that page composition must be derived from the shared projection and cover replacement cannot act
as a reusable media library; richer editorial layouts or shared assets would require a new explicit
capability rather than special cases in the frontend.

Content Covers owns the shared resource lifecycle; each content owner selects its cover.
The [context map](../product/domain-context-map.md) defines that ownership without introducing a reusable media library.
