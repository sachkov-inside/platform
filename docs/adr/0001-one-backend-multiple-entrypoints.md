---
status: accepted
---

# One backend codebase with demand-driven process entrypoints

Platform starts as a pnpm workspace with a Next.js web application and one NestJS backend.
API and MCP are thin process adapters over shared application modules, so application rules remain
local and consistent. Additional process entrypoints are introduced only with concrete runtime
behaviour. Separate backend packages or deployable services are deferred until a module has its
own interface and at least two real consumers; creating them during bootstrap would add
distribution and synchronization cost without product behaviour.

A worker is named and composed for its first durable job and imports only the capability modules
that job needs. The repository does not keep a generic worker, queue lifecycle or readiness contract
as a placeholder. Whether later jobs share a process or use independently deployed workers is an
operational decision made from real scheduling, scaling and failure-isolation requirements.

`pg-boss` remains the selected PostgreSQL job infrastructure, but its dependency, library-owned
schema and lifecycle enter the repository together with the first durable job.
