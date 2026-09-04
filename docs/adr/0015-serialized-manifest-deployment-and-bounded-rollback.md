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
ordinal. The deployment key has no interactive shell, forwarding, PTY, Docker group or general
sudo access; its only sudo target is the root-owned gateway.

Server configuration and secrets remain root-owned under `/etc/inside/runtime`. Deployment derives
release identity and image variables from the manifest under `/var/lib/inside/deployments` and never
rewrites the server-owned files. A no-secret journal records the successful current/previous
identity and the last operation phase. Failure before maintenance preserves the old public route;
failure after it preserves maintenance and an exact retry path. Success is recorded only after
readiness, read-only smoke and the positive route reload.

Database evolution remains forward-only. Starting at `v2`, release publication compares schema
identity from the exact candidate and previous backend digests and binds the exact previous
manifest. Manual rollback is available for 24 hours after successful deployment only when those
identities match. It changes application images and processes without migrations, down migration
or database restore. Different schema identity, unknown state, changed assets or an expired window
requires repair forward. This conservative equality rule can be broadened only by a later decision
with executable evidence for the exact previous application against the candidate schema.
