# Private production metrics (#1404)

The monitoring kit provides Grafana OSS, single-node VictoriaMetrics and an unprivileged
node_exporter. It runs beside the application. The coordinator owns production application,
monitoring installation and rollback. Obtain the production runtime lease before any mutation.
For the current rollout, #854 holds that lease; the worker must never restart production.

```text
release-owned watchdog → readable atomic textfile → native node_exporter
Telegram loopback /metrics ───────────────────────→ VictoriaMetrics → Grafana → official MCP
```

## Installation and runtime window

Prerequisites: Ubuntu amd64, Docker Compose, Python 3, curl, openssl, sha256sum, systemd and an
application release containing this metrics-capable watchdog. The deployed release installs
watchdog code and units from its digest-pinned backend image. `monitoringctl` never installs
watchdog code, and its drop-in changes only `ReadWritePaths`.

An old application release such as v35 cannot provide the new textfile. First deliver the checked
application release through the existing release procedure. Coordinate its maintenance window
separately: an application release restarts application processes. A monitoring-only update does
not restart the application. Do not manually pin a different watchdog executable to the monitoring
bundle; its SQL must follow the deployed application's schema.

Reserve approximately 20 minutes **after images are available and the application prerequisite is
satisfied**: 2–5 minutes for installation/startup, up to 2 minutes for ingestion and inspection,
10 minutes for the pilot, and 3 minutes for stop/rollback contingency. This is a planning estimate,
not a measured production duration. Cold image downloads and the application release need extra
lease time. Installation starts the existing watchdog once and restarts only node_exporter and
monitoring containers. State the application release's expected downtime using its release plan.

From the checked checkout, after the lease is granted:

```bash
sudo bash infra/production/monitoring/monitoringctl install
sudo /opt/inside/monitoring/current/monitoringctl verify
sudo python3 /opt/inside/monitoring/current/measure-pilot.py > /tmp/inside-monitoring-pilot.json
```

Installation records the checkout SHA in `/opt/inside/monitoring/releases/SHA`. It creates local
Grafana secrets without printing them, prepares separate persistent directories, verifies the
node_exporter archive checksum, installs its unit and starts the separate Compose project.
Grafana and VM bind only `127.0.0.1`; node_exporter also binds loopback. No monitoring container
receives a Docker socket, database credentials, Telegram env file or host filesystem mount.
The host collector uses nobody/nogroup and only cpu, meminfo, filesystem, loadavg and textfile.

The renderer reads only `TELEGRAM_LOOPBACK_PORT` from `/etc/inside/telegram/compose.env`, or an
explicit `WATCHDOG_TELEGRAM_APP_URL` from the watchdog setting. It accepts an HTTP loopback URL.
It never sources those files or writes their other values to scrape configuration. Regenerate
configuration with `install` when the Telegram loopback setting changes.

## Update, rollback and stop

Run `update` from the new clean, checked checkout. It keeps credentials and data, records
`previous`, selects the new bundle, refreshes scrape configuration, restarts node_exporter and
recreates only changed monitoring containers. The application remains under its release owner.
If startup or `verify` fails, immediately run rollback, or stop on first installation:

```bash
sudo /opt/inside/monitoring/current/monitoringctl rollback
sudo /opt/inside/monitoring/current/monitoringctl stop
```

Rollback selects the previous monitoring bundle and keeps the release-owned watchdog unchanged.
Grafana database downgrades are not guaranteed by upstream. Before a future Grafana version
upgrade, stop monitoring and take a local copy of `/var/lib/inside/monitoring/grafana`; restore that
copy if the older binary cannot open the upgraded database. VM data compatibility also needs the
upstream release notes for a version change. The initial kit has no previous bundle: stop it.
`stop` removes only monitoring containers and stops node_exporter; it preserves data, secrets and
the release-owned watchdog. It leaves the harmless write-path drop-in and sanitized export.

Application rollback installs the watchdog from the selected old backend image. A pre-metrics
watchdog stops updating the textfile. Its old observations then become stale; do not present them
as recovery. Stop monitoring or return to a checked metrics-capable application release. Do not
restore newer SQL checks over an older application schema. The deployment process contract test
proves that rollback replaces watchdog code while preserving the permissions-only drop-in.

## Operator and agent access

Keep this tunnel open in a terminal owned by the operator:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 3304:127.0.0.1:3304 inside-production
```

Open `http://127.0.0.1:3304`. Obtain the admin password locally from the protected server file;
never put it into a command argument, Git, issue, log or agent configuration. In Grafana,
Administration → Users and access → Service accounts, create a **Viewer** service account and
its token. Store the token on the operator machine with mode `0600`:
`~/.config/inside/metrics-grafana-token`. Server-side Viewer permissions prevent writes even if a
client ignores tool restrictions. Use a separate account/token for each operator; revoke and
replace it in Grafana when needed. Tokens never go into the committed configuration.

`.codex/config.toml` and `.mcp.json` register `platform-metrics` beside `platform-storybook`.
New trusted project sessions discover the repo-relative launcher. Codex project configuration is
loaded only for trusted projects; see [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
and [project configuration](https://learn.chatgpt.com/docs/config-file/config-basic).
Global Codex settings are unchanged. Start sessions from the repository root. The launcher reads
the token file, uses stdio, pins the official Docker image, disables write tools and anonymous
usage reporting, and enables datasource, Prometheus, dashboard, search, alerting and navigation
categories. It preserves instant/range PromQL and metric/label discovery. It does not disable queries.

On Docker Desktop, `host.docker.internal` reaches the operator's tunnel. On Linux use host networking
and `GRAFANA_URL=http://127.0.0.1:3304` as described in the launcher. The launcher requires Docker.
To use a different tunnel port, set `GRAFANA_URL` in the launching session. To use another token
file, set `GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE`; do not store the token value in tracked config.

Use datasource UID `inside-metrics`, dashboard UID `inside-health`, and these initial questions:

- List metric names, label names and values before constructing a query.
- Query `inside_watchdog_source_available` and source-success ages before interpreting business counts.
- Run instant and five-minute range queries for `inside_watchdog_business_count{check="purchases"}`.
- Read the dashboard and alert rules. Confirm the token receives HTTP 403 for a dashboard write.

## Observations, freshness and alert inspection

Business thresholds remain in `infra/production/watchdog/inside-watchdog`. The exporter reuses its
existing reads and exports successful SQL zeros before the positive-value filter. It validates
required rows and numerical values. Empty, malformed, duplicate or incomplete required rows are
unavailable. Failed sources retain the last successful observations and timestamps; active business
signals stay held. Initial unknown values are omitted, rather than invented as healthy zero.

The private watchdog StateDirectory remains `0700`. It caches each last successful source there.
Only numeric observations and bounded source/check/project/state/family labels reach
`/var/lib/inside/metrics/watchdog.prom` (`0644`, directory `0755`). Atomic rename publishes the file
after signal resolution and before the empty-outbox exit. Timestamps are **metric values**, not
Prometheus sample timestamps. The node_exporter user cannot read the watchdog state or outbox.

`inside_watchdog_run_timestamp_seconds` records a completed collection. Read its age as well as
`inside_watchdog_source_last_success_timestamp_seconds`. A stopped watchdog leaves readable stale
files. During a release, suppression preserves the completed timestamp and observations, and sets
`inside_watchdog_deploy_suppressed=1`. A suppressed run is never a new successful observation.

Container `running`, `healthy`, `unhealthy`, `unknown`, `down` and successful one-shot `completed`
states are separate. Running without a healthcheck is `unknown`, not healthy. Container counts
report discovered states. A separate bounded required-service list reports service container counts;
zero means missing, not healthy. This detection has no new business threshold.
Telegram counters support reset-aware `rate`/`increase`. Its gauges can preserve an earlier
reconciliation cycle even when `/metrics` returns 200. HTTP scrape freshness does not prove
reconciliation freshness; inspect readiness, source ages and the gauge's own meaning together.

Provisioned alert rules inspect stale/unavailable sources, failed scrapes, missing required services, held watchdog alerts and
storage budget. No business thresholds are duplicated in Grafana. Rules use no-data/error alerting.
The metrics route is muted for every time of day, SMTP is disabled, and the placeholder receiver
uses a non-routable `.invalid` address. These rules deliver no incident messages. Recipients and
end-to-end incident delivery remain in #1289; no bot or token is required here.

## Retention, resources and acceptance

Collection and alert evaluation start at 60 seconds. VM logical retention is configured to 7 days.
Physical deletion happens later during partition removal and merges; this is not guaranteed erasure
at 168 hours. Seven days of observed retention can be accepted only after seven days have elapsed.
The 2 GiB monitoring-data budget is an operational limit to measure, not guaranteed by retention.
The budget rule inspects VM data; the pilot measures the whole monitoring directory, including Grafana.

Compose caps VM at 384 MiB/0.15 CPU and Grafana at 256 MiB/0.15 CPU. The exporter unit caps memory at
64 MiB and CPU at 5% of one core. These hard limits contain load; they do not prove the pilot targets.
VM caps caches at 128 MiB, query memory at 16 MiB, concurrent queries at 2, queue wait at 5 seconds,
query time at 10 seconds, selected series at 5000, query samples at 1000000, returned series at 1000,
range points at 11000 and label scans at 5000. VM stops ingestion below 1 GiB free storage space.

The read-only pilot measures at least 600 seconds. It reports a conservative resident-memory upper
bound from cgroups plus watchdog peak, CPU as a percentage of total host capacity, minimum host
MemAvailable and total monitoring data. Targets: memory ≤768 MiB, average CPU ≤5%, MemAvailable
≥700 MiB and data <2 GiB. A missing/restarted cgroup invalidates the pilot. If any target fails, stop
**only** monitoring, save the sanitized evidence and report the blocker. Leave the application running.
The worker does not run this production pilot; the coordinator runs it after the lease and acceptance.

Record checked commit, image versions/digests, watchdog release, listener addresses, sample period,
actual measurements and datasource/MCP responses without credentials or customer data. Inspect
`ss -ltnp` locally to verify all three listeners bind `127.0.0.1`; retain only their sanitized rows.

## Isolated verification

```bash
pnpm exec node --test scripts/production-watchdog.test.mjs scripts/production-monitoring.test.mjs
pnpm exec node --test --test-name-pattern='monitoring write permissions' scripts/contracts/production-deployment.test.mjs
bash scripts/heavy-check.sh python3 scripts/monitoring-stack-test.py
pnpm docs:check
pnpm check
```

The real smoke owns its random Compose project and loopback ports. It verifies real node_exporter
textfile ingestion, VM HTTP queries, Grafana provisioning, Viewer write rejection, official MCP
initialize/tools/list, metric/label discovery, instant/range queries and dashboard/alert reads.
It cleans up containers and volumes on failure and success. Before cleanup, failures print service
logs and the last captured HTTP status/body; optional `--evidence-directory PATH` preserves them.
Its bridge network and 64 MiB tmpfs isolate it from production and the singleton application stand.
Only the smoke lowers VM's free-space floor to 4 MiB for that tmpfs; production keeps 1 GiB.
The smoke does not prove production resource targets or seven-day retention.

Same-server monitoring fails with the VPS, SSH, disk or host networking. Existing external checks
remain necessary; this kit adds no independent outage delivery channel.

## Reviewed primary sources

- [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
  and [file-based alert provisioning](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/).
- [VictoriaMetrics single-node limits and retention](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/).
- [node_exporter textfile collector](https://github.com/prometheus/node_exporter#textfile-collector).
- [Official Grafana MCP v2.0.2](https://github.com/grafana/mcp-grafana/blob/v2.0.2/README.md).

Version pins and checksums come from those projects' release assets/OCI manifests, inspected on
2026-10-13. The Compose file and launcher own the exact image digests; the installer owns the
node_exporter archive checksum. No paid/cloud integration, Loki, Tempo or third-party reporting is added.
