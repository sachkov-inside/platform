---
status: accepted
---

# Keep interactive Web mutations browser-owned

Account, Material authoring, publication, deletion and Series ordering use one
browser-owned mutation path: a Client Component calls `useMutation`, its browser adapter sends a
same-origin request, a capability Route Handler authenticates and validates the request boundary,
and the server adapter calls Nest through the generated transport. The backend remains the owner of
authorization, idempotency, concurrency and domain invariants.

Platform does not use Server Actions for these product mutations. They would add a second RPC
mechanism beside TanStack Query without supplying a server-rendering benefit to the current
interactive workspaces. Native authentication forms remain ordinary HTTP forms. Public RSC reads
continue to call the server-only backend transport directly, and a future mutation with a concrete
progressive-enhancement or RSC requirement may revisit this decision instead of creating a parallel
path implicitly.

Route Handlers are capability adapters, not a universal proxy. The shared handler owns only the
common Origin, session, no-store and body-size boundary; each feature owns form parsing and outcome
mapping. Query providers live at the lowest route layout shared by their consumers, so unrelated
public routes do not receive TanStack Query or editor code.

The trade-off is that JavaScript is required for these authenticated interactive mutations. In
return, each operation has one pending/error lifecycle, one retry owner and one observable request
path. Web architecture guardrails reject Server Actions, upward or cross-slice FSD imports, direct
browser-to-Nest calls and Tiptap reachability from lightweight authoring list routes.
