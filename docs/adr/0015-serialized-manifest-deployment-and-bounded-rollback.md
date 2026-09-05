---
status: accepted
---

# Serialize manifest-bound deployment and keep rollback explicit and bounded

Production application changes enter through one manual GitHub Actions workflow. A caller selects
an existing ordinal release and either `deploy` or `rollback`. GitHub queues all commands with one
`queue: max` concurrency group, does not cancel an active command, and rechecks the immutable
Release and its successful publication run after waiting. The host independently holds an
exclusive operation lock, so GitHub is not the last concurrency boundary.

Every Release carries a closed manifest and one digest-bound runtime bundle. The bundle contains
Compose, the positive Caddy route fragment, maintenance response and the deployment state machine
from the same source SHA as the images. The host gateway accepts only two forced SSH command shapes
and a two-file payload, validates both archives before mutation and refuses to replace a staged
ordinal. Before it executes bundled code, the host independently queries the fixed public GitHub
repository, requires the manifest to be byte-identical to the selected immutable Release and
verifies its successful publication workflow. A stolen deployment key can therefore request only
published operations; it cannot introduce executable bytes. The deployment key has no interactive
shell, forwarding, PTY, Docker group or general sudo access; its only sudo target is the root-owned
gateway.

Server configuration and secrets remain root-owned under `/etc/inside/runtime`. Deployment derives
release identity and image variables from the manifest under `/var/lib/inside/deployments` and never
rewrites the server-owned files. A no-secret journal records the successful current/previous
identity and the last operation phase. Before maintenance, preflight uses the already deployed
immutable image without pulling to prove that the live database still has the exact recorded
runtime schema identity. That identity covers both the Platform migration registry and the
PgBoss-managed schema version. Maintenance then precedes exact image pulls as the fixed deployment
sequence requires; the candidate image performs a read-only compatibility check before workers or
migrations change. A retry after migrations may use a same-operation recovery phase retained in a
failed or still-running operation journal and the already local candidate image to prove a
compatible intermediate or exact target schema. This also covers the first deployment and an
abrupt process or host interruption that cannot run an exit trap. Unrelated drift still fails
before maintenance. If the immutable candidate cannot be repaired by an exact retry after its
migrations may have changed the database, the only alternative is a deployment of its immediate
next ordinal. That release must bind the exact failed manifest. The
failed image first proves the live schema, its workers are stopped, and the new image proves that it
can migrate the live schema forward after the normal maintenance and pull steps. The superseded
operation journal is retained under `operation-history`; repair forward does not create a rollback
target for an application version that never deployed successfully. The new operation journal
retains a closed `repairForward` link to that archived version, run and recovery phase, so an exact
retry reconstructs the same ordinal and schema context. A failed repair candidate can itself be
repaired by the next ordinal. Each link is checked against its archived operation and manifest back
to the successful state or the initial failed `v1`; incomplete history cannot authorize mutation.
If the successful state was atomically
written immediately before an interruption, the exact retry validates that state, live schema and
history as a no-op and closes the unfinished operation journal. Success is recorded only after
readiness, read-only smoke and the positive route reload.

The executable proof is intentionally layered. A disposable host filesystem drives the real SSH
gateway, archive validation, journal and deployment state machine through `v1`, no-op, `v2`,
rollback, `v1 → v2` and `v2 → v3` repair-forward paths, and controlled failures at every state
transition; deterministic stand-ins expose the Docker, Caddy and HTTP calls for ordering
assertions. The isolated production Compose smoke then runs the same bundle's actual images,
PostgreSQL, migrations, PgBoss workers, readiness and Caddy data plane. Keeping fault injection out
of the real data-plane probe makes failures reproducible without weakening either boundary.

Database evolution remains forward-only. Starting at `v2`, release publication compares schema
identity from the exact candidate and previous backend digests and binds the exact previous
manifest. Manual rollback is available for 24 hours after successful deployment only when those
identities match. It changes application images and processes without migrations, down migration
or database restore. Different schema identity, unknown state, changed assets or a new selection
after the window expires requires repair forward. An eligible rollback that already passed preflight
and entered a mutating phase keeps its exact retry path after the deadline; otherwise a transient
failure could strand maintenance permanently. This conservative equality rule can be broadened only
by a later decision with executable evidence for the exact previous application against the
candidate schema.

Successful rollback retains `rolledBackFrom` as an additional deployment predecessor. It permits
the immediate corrective release without restarting the version just rolled back. The manifest
must bind that recorded predecessor, and preflight still proves the actual running schema. This
transition keeps the running application as `previous` but does not infer rollback compatibility
to it from a publication proof for a different release.

The repository Zod schema is the canonical release-manifest contract wherever repository code can
run. Two deliberately smaller bootstrap predicates repeat its closed shape: the no-checkout GitHub
deployment job must authenticate immutable release bytes before loading any of them, and the host
gateway must validate those bytes before executing the bundled program. Neither boundary may load
code from current `main`, and the provisioned host does not depend on Node.js. Contract fixtures
exercise these independent fail-closed checks so a manifest evolution cannot silently widen them.
