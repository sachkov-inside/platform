---
status: accepted
---

# Keep the Library catalog client-owned

Library search, facets and cursor continuation use one browser-owned TanStack Infinite Query. The
static Next route renders metadata and a hydration-safe loading shell, but does not read
`searchParams`, fetch, prefetch or dehydrate catalog results. After mount, the browser parses and
normalizes the shareable filter URL with `history.replaceState`, then calls the feature-owned
same-origin BFF. Search and filter state stays in the URL; cursor state stays inside the infinite
query.

This replaces Library's request-isolated server query plus browser hydration path from ADR 0007.
The catalog is an authenticated, highly interactive workspace where immediate filters and ordinary
infinite scroll matter more than server-rendered cards. Public Material, Topic, Series and Roadmap
surfaces keep their server-rendering decisions.

The trade-off is deliberate: crawlers and no-JavaScript clients receive Library metadata and its
shell, not catalog cards. In return, Library has one request path, one cache owner and no
server/browser query coordination. A future requirement for indexable catalog results must revisit
this ADR and use the complete TanStack SSR prefetch/dehydrate/hydrate path rather than adding a
parallel server fetch.
