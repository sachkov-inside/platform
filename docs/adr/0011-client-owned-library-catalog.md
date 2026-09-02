---
status: accepted
---

# Keep the Library catalog client-owned

This ADR supersedes ADR 0007 and restates its retained transport and runtime boundaries. Nest owns
the HTTP wire contract. The repository commits deterministic OpenAPI and generates the immutable
TypeScript client into Web's local `src/shared/api/backend` module. Feature adapters treat external
JSON as `unknown`, validate it with focused schemas and map it into presentation models; generated
code does not own feature policy.

React Server Components call the private Nest address through server-only transport. Browser
continuations and mutations call same-origin, feature-owned Next Route Handlers and never receive
the Nest address. Public server-rendered surfaces may call their server adapter directly. HTTP
cache policy belongs to backend/BFF boundaries, not TanStack Query `staleTime`; Account, health,
protected results and errors remain private and non-cacheable. `pnpm api:check` is the deterministic
wire-contract drift check.

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
parallel server fetch. ADR 0007 remains historical evidence only.
