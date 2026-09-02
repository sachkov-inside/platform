---
status: accepted
---

# Feature-first backend modules with DI at real seams

Platform backend capability modules organize application behaviour as vertical use-case folders,
grouped under one `features/` directory. A use case's operation, contract, and transport adapter
are colocated; shared domain, infrastructure, ports, and helpers remain horizontal only when
multiple slices use them. Nest
provider tokens are reserved for process and inter-module interfaces, while local operations stay
plain functions or concrete providers, because a token and factory per use case adds navigation and
wiring cost without a varying production adapter.

Framework-agnostic assembly remains available for seeds, tests, and non-Nest entrypoints. Nest
binds exported facets directly only for production consumers instead of assembling an aggregate
provider and splitting it into pass-through providers. This refines the Nest composition described
in ADR 0009 without changing its deep `Materials` interface, transaction ownership, or persistence
encapsulation. Operational layout, naming, and enforcement rules live in the normative backend
[`CODING_STANDARDS.md`](../../apps/backend/CODING_STANDARDS.md).

Persistence placement is refined by ADR 0005: a slice may use its injected Prisma client directly;
feature-local persistence is not forced through a horizontal repository layer.

`features/` adds navigation hierarchy only. It does not create an interface, provider, or import
seam; the capability `index.ts` remains the external interface. This keeps feature slices visually
separate from horizontal `domain`, `infrastructure`, `ports`, and `shared` implementation.
Deep multi-operation interfaces such as `MaterialAuthoring` and `Accounts` live under
`facets/`; they are not mislabeled as one action slice. Transport adapters for such facets live
under `adapters/` until an endpoint owns a genuinely independent use case.

The rejected alternatives are a repository-wide layer-first `application/domain/infrastructure`
tree, classic Nest `controller/service/repository` folders, and a DI token per operation. They are
valid framework styles, but for Platform they reduce use-case locality or introduce hypothetical
seams.
