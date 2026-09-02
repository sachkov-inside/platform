# Production host and recovery foundation

This runbook owns the long-lived single-host foundation: host convergence, restricted deploy
access, SOPS/age recovery, provider preflight, Logto, PostgreSQL/pgBackRest and recovery drills.
Application image publication, full release activation and rollback belong to the delivery
workflow. Real provider creation and production cutover remain the owner-gated work in issue #244.

## Safety boundary

Run the repository drills only against their generated Docker projects and synthetic credentials.
They never use the shared development Compose project. Do not run host bootstrap on an existing
server: it is intentionally fail-closed for unsupported capacity and non-empty unmanaged paths,
but it installs packages, enables the firewall and system services on a qualifying root filesystem.

The supported host is Ubuntu 24.04 x86-64 with at least 4 CPUs, 8 GiB memory and 80 GiB available
disk. Ports 22, 80 and 443 are the only inbound firewall allowances. PostgreSQL and Logto are not
published publicly; system Caddy is the only public entry point. Keep at least the four release
slots declared by the host manifest within the disk budget.

## Prove the foundation locally

Run the static and synthetic proof from a repository checkout with the pinned Node/pnpm toolchain,
Docker Compose, SOPS and age:

```bash
pnpm test:tooling
pnpm foundation:smoke
```

`foundation:smoke` creates an isolated TLS MinIO fixture and synthetic credentials. It runs Logto's
pinned migrations twice, proves its OIDC discovery document, backs up both `inside` and `logto`,
deletes the PostgreSQL volume twice, and verifies latest-state and point-in-time recovery. Its JSON
evidence is accepted only at RPO <= 3600 seconds and RTO <= 14400 seconds. A failed CI drill keeps
only container state and an explicit failure note; raw service logs are excluded from artifacts.
Diagnostics are retained for seven days.

On x86-64, the same command also starts a privileged, disposable, digest-pinned Ubuntu 24.04
systemd container and runs the real package/bootstrap path twice. It verifies pinned runtime
versions, UFW, SSH, system Caddy, Docker, deploy ownership/sudo isolation and production
root/tmpfs secret materialization. ARM developer machines skip this architecture-specific proof;
the required `ubuntu-24.04` CI runner always executes it.

The secret half generates distinct disposable host/offline recipients, encrypts one synthetic
document, rejects a persistent runtime root and generation reuse, materializes root-only
per-process files, deletes the host identity and proves recovery with the offline identity. Error
output is checked for value disclosure.

## Bootstrap a clean approved host

Issue #244 must identify the disposable or production host and approve this state change first.
Inspect the pinned manifest, then run preflight before bootstrap:

```bash
sudo python3 infra/production/host/host-foundation.py preflight
sudo infra/production/host/bootstrap-host.sh
sudo /usr/local/libexec/inside/host-foundation.py deploy \
  --original-command 'foundation preflight'
```

Bootstrap installs exact Docker, Compose, Caddy, Node, SOPS and age versions; enables Docker, SSH,
system Caddy and UFW; creates the `inside-deploy` system identity; installs the backup timer units;
and converges `/opt/inside/foundation/current` to foundation `v1`. Repeating bootstrap must produce
the same managed files and modes.

Install the approved deploy public key separately as an owner gate. SSH forces
`inside-deploy-command`, disables TTY and forwarding, and accepts only these primitives:

```text
foundation preflight
release status
release prepare vN
release activate vN
release prune
```

Do not add `inside-deploy` to the Docker group and do not broaden its sudo rule. `release activate`
requires a non-symlink, non-group/world-writable `manifest.json`; `current` and `previous` switch
atomically. `release prune` removes only the oldest inactive versions and leaves one bounded slot
for the next prepare. The deployment workflow owns how a complete signed release reaches its
prepared slot.

## Create and materialize production secrets

Generate the host identity on the approved host and keep its private file root-only:

```bash
sudo age-keygen -o /etc/inside/age/host.txt
sudo chmod 600 /etc/inside/age/host.txt
sudo age-keygen -y /etc/inside/age/host.txt
```

Generate the offline identity on a separate encrypted offline medium. Record only both public
recipients in the cutover worksheet. Never copy the offline private identity to the host.

Build the input document directly in a protected tmpfs or secret-input channel. It must contain
`schemaVersion: 1` and exactly the logical keys named by
`infra/production/secrets/secret-policy.json`. Encrypt from stdin; the output ciphertext is the
only secret artifact allowed in Git:

```bash
node scripts/production-secrets.mjs encrypt \
  --output config/production/secrets.production.sops.json \
  --host-recipient age1HOST \
  --offline-recipient age1OFFLINE < /run/inside-secret-input.json
```

Copy the ciphertext to the host and materialize a new generation. The installed materializer uses
the installed policy and writes service-specific files with mode `0400` under the root-only `/run`
tree:

```bash
sudo node /opt/inside/foundation/current/infra/production/secrets/production-secrets.mjs materialize \
  --encrypted /etc/inside/secrets.production.sops.json \
  --runtime-root /run/inside/secrets \
  --generation v1 \
  --age-key-file /etc/inside/age/host.txt
```

After every rotation: add the new recipient, deploy a new ciphertext and generation, prove each
consumer and offline decryption, then remove the old generation with the `cleanup` command and
revoke the old recipient. Never remove `current`; the command refuses it. A lost-host exercise must
rebuild a disposable host, use only the offline identity to materialize, and destroy the recovered
plaintext when evidence has been recorded.

## Provider preflight and degraded mode

Copy `infra/production/config/provider-contract.example.json` outside Git and replace every
placeholder. Release preflight validates exact Platform/auth origins, issuer, audience, callback,
Yandex endpoint and region, distinct public/protected/quarantine/backup buckets, distinct asset and
backup credential references, separate Kinescope projects, the Telegram identity-link path and the
exact `/mcp` URL. It can additionally compare the materialized asset and backup access-key IDs
without printing them:

```bash
export PRODUCTION_PROVIDER_CONTRACT=/etc/inside/provider-contract.json
node scripts/production-provider-preflight.mjs \
  --config "$PRODUCTION_PROVIDER_CONTRACT" \
  --runtime-secret-root /run/inside/secrets
```

The example deliberately fails until placeholders are replaced. A release profile requires email,
assets, Kinescope, Telegram and MCP to be enabled. If an owner gate cannot be satisfied, change the
profile to `degraded` and explicitly set each unavailable provider to `{ "state": "disabled" }`;
do not manufacture credentials or silently fall back to test adapters. Application route/worker
disablement is consumed by the application runtime work, not implemented by this foundation.

Create the backup bucket and service account separately from all asset buckets and the asset
service account. Grant the backup identity only the object-storage permissions needed by
pgBackRest. Grant no application process the backup identity or repository cipher passphrase.

## Start long-lived data and identity services

Create root-owned public configuration in `/etc/inside/foundation` and materialize secrets before
starting services. The database public file supplies the Yandex S3 endpoint, region, bucket and TLS
settings; the secret files supply the PostgreSQL authorities, backup identity and repository cipher.
Validate without rendering expanded secret values:

```bash
export FOUNDATION_PUBLIC_CONFIG_DIR=/etc/inside/foundation
export FOUNDATION_SECRET_CONFIG_DIR=/run/inside/secrets/current
docker compose \
  --file /opt/inside/foundation/current/infra/production/database/compose.yaml \
  config --quiet
docker compose \
  --file /opt/inside/foundation/current/infra/production/database/compose.yaml \
  up --detach --wait postgres
docker compose \
  --file /opt/inside/foundation/current/infra/production/database/compose.yaml \
  --profile operations run --rm pgbackrest \
  --stanza=production stanza-create
docker compose \
  --file /opt/inside/foundation/current/infra/production/database/compose.yaml \
  --profile operations run --rm pgbackrest \
  --stanza=production check
```

The database image creates `inside` and `logto` with separate owners and a restricted Platform
runtime login. Start the separate Logto stack only after the database check succeeds:

```bash
docker compose \
  --file /opt/inside/foundation/current/infra/production/logto/compose.yaml \
  up --detach --wait
docker compose \
  --file /opt/inside/foundation/current/infra/production/logto/compose.yaml \
  run --rm logto-migrations
```

Repeated Logto migration must exit successfully. Confirm OIDC discovery through the loopback port,
then configure the SMTP connector and Platform application through the pinned Logto Management API
using the one-shot owner procedure. Do not enable or proxy Logto Console. Caddy imports only tracked
route fragments from `/srv/inside/runtime/caddy`; public route ownership remains the application
runtime task.

Enable the installed timers only after the real backup repository passes `stanza-create`, `check`
and a manual full backup:

```bash
sudo systemctl start inside-pgbackrest-backup@full.service
sudo systemctl enable --now \
  inside-pgbackrest-full.timer \
  inside-pgbackrest-diff.timer \
  inside-pgbackrest-incr.timer
systemctl list-timers 'inside-pgbackrest-*'
```

The policy is weekly full on Sunday, daily differential Monday through Saturday and incremental at
00:00, 06:00, 12:00 and 18:00 UTC, with continuous WAL archiving and four retained full backups.

## PITR and empty-host recovery

Schedule the synthetic disposable drill on every foundation change. After cutover, run a real
non-production restore monthly and an empty-host rebuild quarterly. Record only backup label,
database names, target timestamp, elapsed seconds and pass/fail; never attach configuration,
environment dumps, SQL rows or provider values.

For an incident, stop writers and Logto, preserve the failed data volume for forensics, and create a
new empty PostgreSQL volume. Select and record the target from pgBackRest metadata. Run the guarded
restore operation with either latest state or explicit PITR parameters, start PostgreSQL, and verify
both `inside` and `logto` before reopening traffic:

```bash
docker compose \
  --file /opt/inside/foundation/current/infra/production/database/compose.yaml \
  --profile operations run --rm restore \
  --stanza=production --type=time \
  --target='YYYY-MM-DD HH:MM:SS.US+00' \
  --target-action=promote restore
```

Do not reuse a non-empty `PGDATA`; the restore entrypoint refuses any path except the pinned data
directory and clears only that exact empty replacement volume. After validation, run `pgbackrest
check`, take a new full backup on the promoted timeline, confirm WAL archiving and only then restore
traffic. Escalate if either database is absent, RPO exceeds one hour, RTO exceeds four hours, the
repository cannot decrypt with the offline identity, or logs contain a secret value.
