---
status: superseded by ADR-0010
---

# Separate stable and Next-managed TypeScript projects

The Web editor and explicit `tsc` check use the committed `tsconfig.json`. It includes production
route types and excludes `.next/dev`, so diagnostics do not depend on artifacts left by a previous
`next dev` session.

Next.js uses `tsconfig.next.json` for route generation, development and production builds. That
managed project may include `.next/dev/types` without rewriting the editor project. Production
builds originally used the Next TypeScript API checker, which filtered stale development route
artifacts before checking. ADR 0010 supersedes that checker because TypeScript 7 removed the
JavaScript compiler API. Keeping one Next-managed config was rejected because `next typegen` restores the dev glob
and makes VS Code and direct CLI checks depend on mutable development output.

The tooling contract test owns this split and fails if the editor project regains `.next/dev`, the
managed project stops extending it, or Next stops selecting the managed project.
