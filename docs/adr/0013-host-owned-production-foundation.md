---
status: accepted
---

# Keep the production host and recovery foundation separate from application releases

Platform uses one reproducible Ubuntu 24.04 x86-64 host foundation for the first production
contour. The host owns system Caddy, Docker Engine with Compose, SOPS/age, the restricted deploy
identity, the versioned release filesystem, secret materialization, the long-lived Logto stack and
one PostgreSQL/pgBackRest stack. Application releases consume these facilities but do not install,
replace or silently reconfigure them.

The deploy SSH identity is non-interactive, is not a member of the Docker group and reaches root
operations only through one forced-command allowlist. Release directories use bounded `vN`
identities and atomic `current`/`previous` pointers. Full release upload, application activation and
rollback orchestration remain the deployment workflow's responsibility; the foundation exposes
only the low-level filesystem primitive.

Production secret values are one SOPS ciphertext encrypted to two distinct age recipients: a host
identity and an offline recovery identity. The host identity stays root-only under `/etc`; decrypted
per-process subsets exist only in a generation under the tmpfs-backed `/run` tree, with an atomic
`current` pointer. Neither identities nor decrypted values belong in Git, images, Compose output,
logs or recovery evidence. Losing the host must remain recoverable with the offline recipient, and
recipient rotation follows add, deploy, prove, then revoke.

Logto is a long-lived stack separate from application releases. Its migration job is one-shot and
its runtime listens only on loopback for system Caddy. Platform and Logto share one PostgreSQL
cluster but have separate databases and login authorities. Logto's migration authority has only
the additional `CREATEROLE` capability required by Logto's tenant bootstrap; it is not a
superuser and Platform runtime does not receive it. PostgreSQL is never published on the host.

pgBackRest continuously archives WAL to a backup-specific S3-compatible bucket using a
backup-specific service identity and client-side AES-256-CBC repository encryption. Four weekly
full backups are retained; differential backups run daily between full backups and incremental
backups run every six hours. The same protected repository covers the Platform and Logto databases.
Asset buckets and their service identity are deliberately disjoint from backup storage and its
identity, so an application-storage compromise does not grant backup deletion.

The executable recovery contract is stronger than configuration validation. A disposable drill
creates both databases, runs Logto migrations twice, writes markers on both sides of a target,
takes full and incremental backups, deletes the PostgreSQL data volume, restores the latest state
on an empty host, deletes it again and performs PITR between the markers. Evidence is accepted only
when both databases meet RPO at most one hour and RTO at most four hours.

This decision accepts a single-host availability boundary for the first release and an outbound
backup-egress network for PostgreSQL/pgBackRest. It does not provision the real VPS, DNS, SMTP,
Yandex Object Storage, Kinescope, Telegram or production credentials. Those are explicit owner
gates, while provider preflight fails closed on incomplete release configuration and permits only
an explicitly selected degraded profile.
