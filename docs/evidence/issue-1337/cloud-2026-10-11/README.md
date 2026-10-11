# #1337 — Cloud acquisition and runtime evidence, 11 October 2026

The task branch includes `origin/main` at `e00efc1c9ee53462462e6eb6eff734a2d17fb827`
through a merge. No previous `127b36d8` build/check/smoke result establishes a pass here.
The PR's final check links identify its final HEAD; records below name their own Source.

## Public official RabbitMQ inputs

[Trusted publication run 38125155437](https://github.com/sachkov-inside/platform/actions/runs/38125155437)
on `bac727908ab087a89e8dbf421830b6b88e19b64a` copied exactly the three authorized Docker Library
images with `skopeo copy --all --preserve-digests`, without rebuilding. The permanent publisher
runs only on trusted `main`; its job alone receives `packages:write` through `GITHUB_TOKEN`.

| GHCR tag | Preserved index digest | Anonymous cold reference / cached pull, seconds |
| --- | --- | --- |
| `4.2.4-management-alpine` | `sha256:adac51a4a14a200b8eb928a12787564ed56e93fc55e789a73ec13e1e2eac7aef` | 10.37 / 5.34 |
| `4.2.4-alpine` | `sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47` | 6.20 / 5.34 |
| `4.3-management-alpine` | `sha256:3ef7f7e89fed709a78f79b8b5f4e30e1312a1d4089da752e23595566d9d61a95` | 6.41 / 5.67 |

All repositories are `ghcr.io/sachkov-inside/rabbitmq`. [The manifest receipt](mirror-manifests.json)
records byte equality of each index and all 16 referenced child manifests per index, with actual
child SHA-256 checks, including unchanged Linux amd64/arm64 digests. Artifacts 11696881357,
11696746848 and 11696911608 belong to that publication run and retain the raw compared manifests.

[Native pull receipts](anonymous-pulls.json) used the managed local Unix-socket Docker Engine and
an owned empty `config.json` (`auths: {}`). Each exact GHCR reference was absent before its first
pull. All six pulls exited 0; repeated pulls reported up-to-date and retained the same image IDs.
These are cold references, not three independent empty-layer Engines: later versions may share
layers with previous pulls or existing official images. Cached pulls still contact the registry,
so their approximately five-second cost is not a zero-network startup measurement.

## Intermediate application CI and timings

[Run 38125556986](https://github.com/sachkov-inside/platform/actions/runs/38125556986), attempt 1,
tested PR HEAD `8bba5e2b99e5a10cc6c552c041bcd62eafb73b7a`: all nine jobs and CI Gate passed.
This predates the later review correction and nightly test adapters; it is not their final pass.
[GitHub timestamps and step durations](intermediate-ci-timings.json) separate job queue from
setup and execution. Each job waited two seconds from job creation to runner start. The first
jobs were created 20 seconds after workflow creation; CI Gate's dependency wait is not runner queue.

| Job | Setup Platform / command execution, seconds |
| --- | --- |
| Static | 37 / 90 |
| Unit | 32 / 597 |
| UI | 74 / 180 |
| Web E2E | 52 / 291 |
| Integration serial | 30 / 219 |
| Integration | 46 / 247, then 67 enrollment + 57 buyer |

Production runtime smoke took 280 seconds including its builds; its log reports successful
migration, TLS broker, readiness, route, sale configuration and worker handoff assertions.
The following release image builds show real BuildKit `CACHED` layers. Development preparation
took 55 seconds, the clean stack smoke 71 and restart/persistence proof 66; both smokes passed.
The cache-only CI proof now splits exact-source image preparation and admitted runtime into
separate Actions log groups, retaining all runtime assertions and forbidding runtime builds/pulls.

## Local check recommendations

Use pinned Node 26.10.0 and pnpm 11.27.1, the frozen lockfile and `scripts/heavy-check.sh`.
Run focused adapter/process contracts while changing acquisition, ownership or admission. Run
`pnpm docs:check` for contract/runbook changes and `pnpm check` before handoff; the four stages
are also checked independently by the required CI jobs. Reserve real Docker integration and
dev/prod smoke for runtime, image or Compose changes. A UI-only edit does not justify rebuilding
all runtime images before each iteration. Preserve the final whole check and relevant real-boundary
proofs. Record dependency/browser preparation separately from command execution and runner queue.
Do not infer local savings by summing parallel CI job times or by treating a warm pull as no network.
