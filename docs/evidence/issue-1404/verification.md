# Metrics preparation evidence

Scope: local preparation only. Production has not been changed. The owner requires server
expansion and an explicit future deployment decision. Production and resource-pilot acceptance
remain pending in #1404. The PR links `Part of #1404` and `Part of #1289`, without closing references.
The PR result card records the final checked SHA, required-check exit codes and CI URL.

## Isolated execution, 2026-10-13

- `node --test scripts/production-watchdog.test.mjs scripts/production-monitoring.test.mjs`:
  exit 0, 28 tests. Includes failed/incomplete sources, held Telegram/telemetry evidence, readable
  atomic export, Compose service-label format and exited required services versus completed migrations.
- `python3 -m unittest discover -s scripts -p 'test_monitoring_*.py'`: exit 0, 12 tests.
  Restarted Docker ID/PID/StartedAt/RestartCount or exporter InvocationID rejects a pilot even with
  reused cgroup paths. Measurement checks surround baseline, intermediate and final counter reads.
  MCP sample assertions reject value 0 despite a timestamp containing 2, wrong labels and empty ranges.
  The active-watchdog end-window regression reported CPU 0 before the fix and 5% after it.
  CPU deltas include active invocations at both boundaries; an unobserved completion rejects the pilot.
- Guarded real `python3 scripts/monitoring-stack-test.py`: exit 0.
  Real textfile ingestion, datasource query, provisioned dashboard, six alert rules, muted delivery,
  Viewer write HTTP 403, official MCP discovery/instant/range/dashboard/alert reads passed.
  Parsed instant and all nonempty range samples require `check=purchases`, value 2.
- The same smoke copied a token into a Docker volume with Linux UID/GID and mode 0600.
  The pinned official binary successfully authenticated a real query as the operator UID/GID.
  This proof uses Linux filesystem ownership rather than Desktop bind-mount permission translation.
- Guarded smoke injections `--fail-after-start`, `--timeout-after-start`, `--interrupt-after-start`
  and `--kill-after-start`: each intentionally exited 1 and reported `PASS isolated stack cleanup`.
  The timeout spawned a descendant; the outer supervisor owns the worker group even after SIGKILL.
  Cleanup verifies no owned running descendants, containers, networks or volumes remain.

Previous sanitized live-smoke failure is retained in [failure.txt](smoke-failure/failure.txt).
Its Grafana and VM HTTP statuses were 200; its boundary was an obsolete alert-tool expectation.
The current official tool is `alerting_rules_read`. Earlier ingestion failure came from the isolated
64 MiB tmpfs conflicting with the production 1 GiB free-space guard. Only the smoke lowers that guard
to 4 MiB. Readiness budgets and production limits were not extended.

## Independent initial review outcomes

Review base: `4bb1b6a446f2f3c15cbe2886c5b266fe50354d95`; initial head:
`648fb189b3ae5a6c911e9c5ea7dd4c0dd8dac18a`. Final rereview is recorded in the PR.

| Axis | Finding | Outcome |
| --- | --- | --- |
| Standards / Spec | Service label missing from Docker format | Added fourth field; public argument-aware fixture passes. |
| Standards | Cleanup could skip steps or mask failure | Outer supervisor, bounded independent cleanup, original status retained; four actual failure paths pass. |
| Standards | Atomic scrape replacement left old bind inode | Update and rollback explicitly recreate both monitoring containers. |
| Standards / Spec | Restart could undercount pilot CPU | Stable identities and monotonic counters required before/during/final measurement. |
| Spec | Partial telemetry SQL accepted | All ten expected rows required; last successful evidence retained. |
| Spec | Failed Platform SQL cleared skipped Telegram alert | Telegram database alert family is held when its read is skipped. |
| Spec | Query assertion matched timestamp text | Parsed samples and labels required for instant and range. |
| Spec | Same-SHA reinstall destroyed previous bundle | Previous pointer changes only when the selected SHA changes. |
| Coordinator acceptance | Linux Viewer token ownership differs from image user | Launcher runs operator UID/GID; real Linux-volume authentication passed with mode 0600. |
| Coordinator acceptance | Exited(0) required service counted present | Bounded count includes only running services; migration completion remains normal. |
| Standards rereview | Worker wait could bypass remaining cleanup | Kill/wait is an independent bounded step; cleanup ignores repeated catchable signals. |
| Standards rereview | Active watchdog CPU omitted at window boundaries | Invocation CPU deltas include active initial/final reads; incomplete accounting rejects the pilot. |

## Acceptance boundaries

No production listeners, resource targets or seven-day observed retention have been verified.
The current old application release cannot export these metrics. A future checked application
release must install its own metrics-capable watchdog before monitoring installation. No release
is scheduled. The permissions-only drop-in preserves release-image authority over SQL/check logic.
An old-release rollback stops export freshness; restoring newer SQL over that schema is unsupported.
Alert delivery and financial probes remain deferred under #1289. Mirror packet #1402/#1396 is unchanged.
