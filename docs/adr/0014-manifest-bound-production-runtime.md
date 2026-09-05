---
status: accepted
---

# Bind the production runtime to one immutable release and schema identity

Platform deploys one release unit containing seven processes: migrations, API, MCP, web, Material
Asset worker, Profile Avatar worker and Video deletion worker. Production Compose consumes only the
backend and web digest references selected from `release-manifest.json`; it never builds application
source. The release ordinal and source SHA are embedded into a read-only file in both images and
supplied separately as runtime configuration. Every process compares the two identities at startup
and fails closed when they differ; container environment overrides cannot rewrite image identity.

The foundation stack owns PostgreSQL and its internal network. All application processes use one
shared non-superuser `platform` credential, including migrations. This temporarily gives runtime
processes the role's DDL rights; the owner accepted that risk to avoid an unproved privilege split.
The application stack adds separate edge and internal application networks. Service ports bind only
to host loopback, and the system Caddy imports a runtime-owned positive route fragment. Only web,
the exact three integration callbacks, `/mcp` and its protected-resource metadata are public;
unknown integration paths and all health routes return 404 at the edge.

Configuration is validated per process. API receives the complete application configuration; MCP
and each worker require only the groups they consume. Missing owned production configuration stops
that process, while unused provider configuration is neither required nor delivered. External
provider reachability is intentionally absent from global readiness, so a Kinescope, Object Storage,
Telegram or identity-provider outage degrades the affected flow without declaring the whole runtime
unavailable.

Liveness reports the running process and release identity. Readiness additionally proves database
reachability and the exact ordered Platform migration registry, including checksums and a stable
schema identity. Web readiness delegates to API readiness and requires the same release. Workers
write the same bounded report to a private tmpfs marker. Compose healthchecks validate that marker
against the current release and re-query the exact database schema, so a later database or schema
failure invalidates worker health. These endpoints and markers are operational surfaces, not public
product APIs.

Each worker generation holds a process-specific PostgreSQL session advisory lock. A new generation
fails while the previous generation still owns its lock. Deployment must stop and gracefully drain
old workers before starting new ones; shutdown removes readiness before stopping `pg-boss` and
releasing the lease. This gives one explicit no-overlap rule across all current workers without
coupling their job handlers.

Database changes remain forward-only and expand/contract. The migration job first applies the
append-only Platform registry and then lets `pg-boss` converge its own schema. Interruption between
those stages is resumable. CI proves fresh install, previous-schema upgrade, an N-1 application
compatibility probe and failure/resume. It never performs an automatic down migration or restore.
After migrations, the previous application may be selected for manual rollback only when that
compatibility evidence is green; otherwise recovery moves forward.

The basic runtime smoke is deliberately read-only. It proves manifest/image identity, schema
identity, process health, trusted TLS, expected pages and the positive/negative route matrix while
checking that application data did not change. Provider writes and production host mutation belong
to owner-gated delivery and cutover work. ADR 0015 defines the serialized delivery protocol and
bounded manual application rollback layered on this runtime.
