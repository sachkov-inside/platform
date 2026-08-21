---
status: accepted
---

# One backend codebase with multiple process entrypoints

Platform starts as a pnpm workspace with a Next.js web application and one NestJS backend.
API, worker and MCP are thin process adapters over the same application modules, so application
rules remain local and consistent. Separate backend packages or deployable services are deferred
until a module has its own interface and at least two real consumers; creating them during
bootstrap would add distribution and synchronization cost without product behaviour.

The worker owns the `pg-boss` process lifecycle against the shared PostgreSQL database. The
library's internal schema is infrastructure owned by `pg-boss`; product queues, jobs and their
handlers remain future application behaviour and are not part of this bootstrap decision.
